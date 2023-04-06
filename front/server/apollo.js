const config = require('config');
const { ApolloClient } = require('apollo-client');
const { createHttpLink } = require('apollo-link-http');
const {
  InMemoryCache,
  IntrospectionFragmentMatcher
} = require('apollo-cache-inmemory');

global.fetch = require('isomorphic-unfetch');

const fragmentMatcher = new IntrospectionFragmentMatcher({
  introspectionQueryResultData: {
    __schema: {
      types: []
    }
  }
});

module.exports.createClient = function createClient({
  authToken,
  impersonateId
}) {
  const headers = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  if (impersonateId) headers['x-impersonate-id'] = impersonateId;

  return new ApolloClient({
    link: createHttpLink({
      uri: config.get('server.api.graphqlUrl'),
      headers
    }),
    cache: new InMemoryCache({ fragmentMatcher }),
    ssrMode: true
  });
};
