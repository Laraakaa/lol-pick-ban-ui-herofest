class GlobalContext {
  commandLine: {
    data: string;
    record: string;
    leaguePath: string;
    experimentalConnector: boolean;
    debug: boolean;
    heroFest: boolean;
  } = {
    data: '',
    record: '',
    leaguePath: '',
    experimentalConnector: false,
    debug: false,
    heroFest: true
  };
}

export default new GlobalContext();
