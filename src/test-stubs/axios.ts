type AxiosLikeConfig = Record<string, any>;

function makeClient() {
  const client: any = async (config: AxiosLikeConfig) => config;
  client.get = async () => ({ data: {} });
  client.post = async () => ({ data: { results: [] } });
  client.put = async () => ({ data: {} });
  client.interceptors = {
    response: {
      use: () => undefined,
    },
  };
  return client;
}

const axios = {
  create: () => makeClient(),
};

export default axios;
