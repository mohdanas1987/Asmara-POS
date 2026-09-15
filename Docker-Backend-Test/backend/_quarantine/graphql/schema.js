const typeDefs = `#graphql

type Table {
  id: ID
  name: String
  status: String
}

type MenuItem {
  id: ID
  name: String
  price: Float
}

type Query {
  tables: [Table]
  menu: [MenuItem]
}
`;

module.exports = typeDefs;