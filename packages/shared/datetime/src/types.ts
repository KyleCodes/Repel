// An ISO-8601 timestamp in string form. The serialized representation of a
// moment in time — what survives a JSON / JSONB round-trip across queue payloads
// and DB columns, where a live date object cannot. Deserialize to a Luxon
// DateTime at the boundary and work with that internally; serialize back to this
// at the edge.
//
// A plain alias (not a brand) for now: it documents intent at boundaries without
// machinery. Upgrade to a branded type later if string drift becomes a problem —
// call sites won't need to change.
export type Iso8601String = string;
