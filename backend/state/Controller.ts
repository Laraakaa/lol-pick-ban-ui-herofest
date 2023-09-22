import { EventEmitter } from "events";
import convertState from "./converter";
import { CurrentState } from "../data/CurrentState";
import DataProviderService from "../data/DataProviderService";
import State from "./State";
import DataDragon from "../data/league/DataDragon";
import logger from "../logging/logger";
import GlobalContext from '../GlobalContext';
import WebSocket from 'ws';

const log = logger("Controller");

export default class Controller extends EventEmitter {
  dataProvider: DataProviderService;
  state: State;
  ddragon: DataDragon;

  herofestSocket?: WebSocket

  constructor(kwargs: {
    dataProvider: DataProviderService;
    state: State;
    ddragon: DataDragon;
  }) {
    super();

    this.dataProvider = kwargs.dataProvider;
    this.state = kwargs.state;
    this.ddragon = kwargs.ddragon;

    this.herofestReconnect = this.herofestReconnect.bind(this)
    this.herofestConnect = this.herofestConnect.bind(this)
    this.herofest_onopen = this.herofest_onopen.bind(this)
    this.herofest_onerror = this.herofest_onerror.bind(this)
    this.herofest_onclose = this.herofest_onclose.bind(this)

    this.dataProvider.on("connected", () => {
      log.debug("DataProvider connected!");
      this.state.leagueConnected();
    });

    this.dataProvider.on("disconnected", () => {
      log.debug("DataProvider disconnected!");
      this.state.leagueDisconnected();
    });

    if (GlobalContext.commandLine.heroFest) {
      log.debug(`Connecting to herofest websocket on ${this.state.getConfig().herofest.ws}`)
      this.herofestReconnect()
    }
  }

  herofest_onopen(): void {
    log.info(`Connected to herofest websocket on ${this.state.getConfig().herofest.ws}`)
  }

  herofest_onclose(): void {
    log.info(`Disconnected from herofest websocket, attempting reconnect in 500ms`)
    setTimeout(this.herofestReconnect, 500)
  }

  herofest_onerror(e: WebSocket.ErrorEvent): void {
    log.error(`Error on herofest websocket: ${JSON.stringify(e)}`)
  }

  herofestConnect(): void {
    if (this.herofestSocket) {
      this.herofestSocket.onopen = this.herofest_onopen
      this.herofestSocket.onclose = this.herofest_onclose
      this.herofestSocket.onerror = this.herofest_onerror
    }
  }

  herofestReconnect(): void {
    this.herofestSocket = new WebSocket(this.state.getConfig().herofest.ws, [], {
      handshakeTimeout: 100000,
      timeout: 10000
    } as any)
    this.herofestConnect()
  }

  applyNewState(newState: CurrentState): void {
    if (!this.state.data.champSelectActive && newState.isChampSelectActive) {
      log.info("ChampSelect started!");
      this.state.champselectStarted();

      // Also cache information about summoners
      this.dataProvider.cacheSummoners(newState.session).then();
    }
    if (this.state.data.champSelectActive && !newState.isChampSelectActive) {
      log.info("ChampSelect ended!");
      this.state.champselectEnded();
    }

    // We can't do anything if champselect is not active!
    if (!newState.isChampSelectActive) {
      return;
    }

    const cleanedData = convertState(newState, this.dataProvider, this.ddragon);

    const currentActionBefore = this.state.data.getCurrentAction();

    this.state.newState(cleanedData);

    // Get the current action
    const currentActionAfter = this.state.data.getCurrentAction();

    const isActionEqual = (firstAction: any, secondAction: any): boolean => {
      if (firstAction.state !== secondAction.state) {
        return false;
      }
      if (firstAction.state === "none" && secondAction.state === "none") {
        return true;
      }
      if (firstAction.team !== secondAction.team) {
        return false;
      }
      if (firstAction.num === secondAction.num) {
        return true;
      }
      return false;
    };

    if (!isActionEqual(currentActionBefore, currentActionAfter)) {
      const action = this.state.data.refreshAction(currentActionBefore);

      this.state.newAction(action);

      if (GlobalContext.commandLine.heroFest && this.herofestSocket) {
        if (action.state !== 'none') {
          const wsEvent = {
            type: "lol-pickban",
            method: action.state,
            data: {
              displayName: action.data.displayName,
              team: action.team === 'blueTeam' ? 'blue' : 'red',
              champion: {
                id: action.data.champion.id,
                name: action.data.champion.name,
                centeredSplash: `${this.state.getConfig().herofest.host}${action.data.champion.splashCenteredImg}`
              }
            }
          }
          // {"type":"lol-pickban","method":"pick","data":{"champId":123, "side":"blue" "gamertag":"Liva", "url":"http://....."}}
 
          if (this.herofestSocket.readyState === WebSocket.OPEN) {
            this.herofestSocket.send(wsEvent)
          } else {
            log.warn('Had to discard herofest event because socket is not connected')
          }

          // log.info(`Sending websocket pick: ${JSON.stringify(action)}`)
          log.info(`Sending websocket pick: ${JSON.stringify(wsEvent)}`)
        }
      }
    }
  }
}
