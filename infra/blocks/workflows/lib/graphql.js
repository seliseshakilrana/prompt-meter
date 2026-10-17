// Builds the raw GraphQL documents that dataAction nodes run (rawQueryMode).
// Naming follows the blocks-data-gateway-crud skill: queries are get<querySchema>
// (naive "s" plural), mutations stay singular (insertX / updateX / deleteX) with bulk
// variants insertManyX / updateManyX / deleteManyX.
//
// TODO(spike): confirm against the live gateway (blocks data schema get <id>):
//   - the querySchema names below (naive plural, e.g. UserHourlys),
//   - the `where` filter operators (eq / in / gte / lt / or),
//   - the argument shape of insertMany* (input: [..]) and update*/delete* (filter: String),
//   - the format of the `filter` string (assumed: Mongo-style JSON) and how DateTime
//     values must be written inside it.
// Every one of these is isolated in this file so the spike only has to fix it here.
//
// Shared helper: function declarations only. Inlined into code nodes by build.js.

const QUERY_NAMES = {
  UsageEvent: "UsageEvents",
  UserHourly: "UserHourlys",
  TeamHourly: "TeamHourlys",
  IngestKey: "IngestKeys",
  ModelPrice: "ModelPrices",
  RollupState: "RollupStates"
};
const MAX_PAGE_SIZE = 10000;

function gqlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!isFinite(value)) throw new Error("gql_non_finite_number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(gqlValue).join(", ") + "]";
  // Objects are written as "{ a: 1 }" with inner spaces, so a document never contains
  // "{{" or "}}" (the workflow expression delimiters).
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const parts = [];
    for (let i = 0; i < keys.length; i++) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keys[i])) throw new Error("gql_bad_field_name");
      parts.push(keys[i] + ": " + gqlValue(value[keys[i]]));
    }
    return parts.length ? "{ " + parts.join(", ") + " }" : "{ }";
  }
  throw new Error("gql_unsupported_value");
}

function gqlFieldList(fields) {
  for (let i = 0; i < fields.length; i++) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fields[i])) throw new Error("gql_bad_field_name");
  }
  return fields.join(" ");
}

// query { getX(input: {pageNo: 1, pageSize: n}, where: {...}) { items { ... } totalCount } }
function buildListQuery(schemaName, where, fields, pageSize) {
  const queryName = "get" + QUERY_NAMES[schemaName];
  const size = Math.min(pageSize || MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  return (
    "query { " + queryName + "(input: { pageNo: 1, pageSize: " + size + " }" +
    (where ? ", where: " + gqlValue(where) : "") +
    ") { items { " + gqlFieldList(fields) + " } totalCount } }"
  );
}

// Mongo-style JSON filter string used by update*/delete* mutations. TODO(spike): format.
function filterString(filter) {
  return JSON.stringify(filter);
}

function itemIdFilter(itemId) {
  // TODO(spike): the gateway may expect {"_id": ...} or {"ItemId": ...}.
  return filterString({ _id: itemId });
}

function insertManyField(alias, schemaName, rows) {
  return alias + ": insertMany" + schemaName + "(input: " + gqlValue(rows) + ") { acknowledged totalImpactedData message }";
}

function insertField(alias, schemaName, row) {
  return alias + ": insert" + schemaName + "(input: " + gqlValue(row) + ") { acknowledged itemId message }";
}

function updateField(alias, schemaName, filter, input) {
  return alias + ": update" + schemaName + "(filter: " + gqlValue(filter) + ", input: " + gqlValue(input) + ") { acknowledged totalImpactedData message }";
}

function updateManyField(alias, schemaName, filter, input) {
  return alias + ": updateMany" + schemaName + "(filter: " + gqlValue(filter) + ", input: " + gqlValue(input) + ") { acknowledged totalImpactedData message }";
}

function deleteManyField(alias, schemaName, filter) {
  // TODO(spike): delete* takes `input: XDeleteInput!` per the CRUD skill; its fields are unknown,
  // so only the filter is sent here.
  return alias + ": deleteMany" + schemaName + "(filter: " + gqlValue(filter) + ") { acknowledged totalImpactedData message }";
}

function deleteField(alias, schemaName, filter) {
  return alias + ": delete" + schemaName + "(filter: " + gqlValue(filter) + ") { acknowledged totalImpactedData message }";
}

// Top-level mutation fields run one after another (GraphQL spec), so ordering inside one
// document is safe: e.g. delete the old hourly rows, then insert the rebuilt ones.
function buildMutation(fields) {
  return "mutation { " + fields.join(" ") + " }";
}
