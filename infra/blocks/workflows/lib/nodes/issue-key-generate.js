// Code node "Generate Key" (issue-key.json). Mode: each.
// Input: "Get Caller Organizations" (GET /iam/v4/iam/organizations/my as the caller).
// Checks the caller belongs to the requested team, generates pm_<prefix>_<secret>,
// stores only keyPrefix + keyHash, and returns the full key once.
// A keyPrefix collision is caught by the unique index on IngestKey.keyPrefix (-> 500, retry).
// TODO(spike): the full key is in this node's output; check whether workflow execution
// history keeps node outputs, and who can read it.
// Helpers: workflow-io, sha256, ingest-key, graphql.

const bad = function (statusCode, error) { return { ok: false, statusCode: statusCode, responseBody: { error: error } }; };
const caller = nodeOutput($node, "Identify Caller");
if (!caller.ok) return caller;
const body = caller.body || {};
const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
if (!teamId) return bad(400, "team_id_required");
const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : "Ingest key";
if (body.sendPreview !== undefined && typeof body.sendPreview !== "boolean") return bad(400, "invalid_send_preview");
const sendPreview = body.sendPreview === true;
if (!membershipIn($json, teamId)) return bad(403, "not_a_team_member");

const generated = generateIngestKey();
const row = {
  userId: caller.callerId,
  teamId: teamId,
  label: label,
  keyPrefix: generated.keyPrefix,
  keyHash: generated.keyHash,
  sendPreview: sendPreview,
  lastUsedAt: null,
  revoked: false,
  rateWindowStart: null,
  rateWindowCount: 0
};
return {
  ok: true,
  statusCode: 200,
  insertMutation: buildMutation([insertField("key", "IngestKey", row)]),
  responseBody: { key: generated.key, keyPrefix: generated.keyPrefix, teamId: teamId, label: label, sendPreview: sendPreview }
};
