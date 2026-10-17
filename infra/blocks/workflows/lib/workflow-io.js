// Reading node outputs, webhook requests and IAM responses inside code nodes.
//
// TODO(spike): the exact data paths are not documented. The workflow skill's examples
// read webhook bodies as `$node[<trigger name>].json.output.<field>`, if-node conditions as
// `$json.output.<field>`, and code nodes read upstream httpRequest results as
// `$json.<field>`. These helpers accept every one of those shapes so the scripts keep
// working whichever one the engine uses; once the spike pins it down they can be narrowed.
//
// Shared helper: function declarations only. Inlined into code nodes by build.js.

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Removes one `output` wrapper if present.
function unwrapOutput(value) {
  if (isPlainObject(value) && isPlainObject(value.output)) return value.output;
  return value;
}

// Output of a named upstream node, unwrapped.
function nodeOutput(nodes, name) {
  const entry = nodes && nodes[name];
  if (!entry) return {};
  const json = entry.json !== undefined ? entry.json : entry;
  return unwrapOutput(json) || {};
}

// Items from a dataAction getData / rawQuery result, whatever the wrapper.
function extractItems(result) {
  let value = unwrapOutput(result);
  for (let depth = 0; depth < 6 && value != null; depth++) {
    if (Array.isArray(value)) return value;
    if (!isPlainObject(value)) return [];
    if (Array.isArray(value.items)) return value.items;
    if (value.data !== undefined) { value = value.data; continue; }
    if (value.output !== undefined) { value = value.output; continue; }
    // { getUsageEvents: { items: [...] } } -> the single key's value
    const keys = Object.keys(value).filter(function (k) { return k !== "errors" && k !== "extensions"; });
    if (keys.length === 1 && (isPlainObject(value[keys[0]]) || Array.isArray(value[keys[0]]))) {
      value = value[keys[0]];
      continue;
    }
    return [];
  }
  return [];
}

function extractTotalCount(result) {
  let value = unwrapOutput(result);
  for (let depth = 0; depth < 6 && isPlainObject(value); depth++) {
    if (typeof value.totalCount === "number") return value.totalCount;
    const next = value.data !== undefined ? value.data : value.output !== undefined ? value.output : null;
    if (next !== null) { value = next; continue; }
    const keys = Object.keys(value);
    if (keys.length === 1) { value = value[keys[0]]; continue; }
    return null;
  }
  return null;
}

// True when a GraphQL / dataAction result reports an error.
function resultErrors(result) {
  const value = unwrapOutput(result);
  const errors = [];
  const visit = function (v, depth) {
    if (!isPlainObject(v) || depth > 4) return;
    if (Array.isArray(v.errors) && v.errors.length) errors.push.apply(errors, v.errors);
    if (v.isSuccess === false) errors.push(v.message || v.errors || "isSuccess=false");
    if (v.acknowledged === false) errors.push(v.message || "acknowledged=false");
    const keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== "errors") visit(v[keys[i]], depth + 1);
    }
  };
  visit(value, 0);
  return errors;
}

function headerValue(headers, name) {
  if (!isPlainObject(headers)) return null;
  const wanted = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === wanted) {
      const v = headers[keys[i]];
      if (Array.isArray(v)) return v.length ? String(v[0]) : null;
      return v === null || v === undefined ? null : String(v);
    }
  }
  return null;
}

function utf8Length(text) {
  let n = 0;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

// Finds headers and body in a webhook trigger's output.
// Returns { headers, body (object|null), rawBody (string|null), parseError (bool) }.
function readWebhookRequest(trigger) {
  const t = isPlainObject(trigger) ? trigger : {};
  const out = isPlainObject(t.output) ? t.output : {};
  const headerCandidates = [t.headers, out.headers, t.request && t.request.headers, out.request && out.request.headers];
  let headers = {};
  for (let i = 0; i < headerCandidates.length; i++) {
    if (isPlainObject(headerCandidates[i])) { headers = headerCandidates[i]; break; }
  }
  const bodyCandidates = [t.body, out.body, t.request && t.request.body, out.request && out.request.body, t.output, t];
  let rawBody = null;
  for (let i = 0; i < bodyCandidates.length; i++) {
    const c = bodyCandidates[i];
    if (isPlainObject(c) && (c.events !== undefined || c.collector !== undefined || c.action !== undefined || c.teamId !== undefined || c.keyId !== undefined || c.mode !== undefined)) {
      return { headers: headers, body: c, rawBody: null, parseError: false };
    }
    if (typeof c === "string" && rawBody === null) rawBody = c;
  }
  if (rawBody !== null) {
    try {
      const parsed = JSON.parse(rawBody);
      return { headers: headers, body: isPlainObject(parsed) ? parsed : null, rawBody: rawBody, parseError: !isPlainObject(parsed) };
    } catch (error) {
      return { headers: headers, body: null, rawBody: rawBody, parseError: true };
    }
  }
  const fallback = isPlainObject(out) && Object.keys(out).length ? out : null;
  return { headers: headers, body: fallback, rawBody: null, parseError: false };
}

// Request size in bytes: Content-Length if sent, else the raw body, else re-serialized JSON.
// TODO(spike): the re-serialized size is only an approximation of the bytes on the wire.
function requestBytes(request) {
  const declared = Number(headerValue(request.headers, "content-length"));
  if (isFinite(declared) && declared > 0) return declared;
  if (typeof request.rawBody === "string") return utf8Length(request.rawBody);
  if (request.body) return utf8Length(JSON.stringify(request.body));
  return 0;
}

// Fixed one-minute window per key. Returns { allowed, retryAfterSeconds, windowStart, windowCount }.
function rateLimitDecision(windowStartIso, windowCount, nowMs, limitPerMinute) {
  const start = windowStartIso ? new Date(windowStartIso).getTime() : NaN;
  const count = typeof windowCount === "number" && windowCount > 0 ? windowCount : 0;
  if (!isNaN(start) && nowMs - start < 60000 && nowMs >= start) {
    if (count >= limitPerMinute) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((start + 60000 - nowMs) / 1000)), windowStart: new Date(start).toISOString(), windowCount: count };
    }
    return { allowed: true, retryAfterSeconds: 0, windowStart: new Date(start).toISOString(), windowCount: count + 1 };
  }
  return { allowed: true, retryAfterSeconds: 0, windowStart: new Date(nowMs).toISOString(), windowCount: 1 };
}

// ---- IAM response readers. TODO(spike): response shapes of /iam/v4/iam/me,
// /iam/v4/iam/organizations/my and /iam/v4/iam/users/{id}?organizationId=... are not
// documented; these accept the common shapes and fail closed (no id / not a member).

function iamPayload(response) {
  let v = unwrapOutput(response);
  for (let i = 0; i < 3 && isPlainObject(v) && v.data !== undefined && !v.itemId && !v.userId; i++) v = v.data;
  return v;
}

function extractUserId(meResponse) {
  const v = iamPayload(meResponse);
  if (!isPlainObject(v)) return null;
  const candidates = [v.itemId, v.ItemId, v.userId, v.id, v.user && (v.user.itemId || v.user.id)];
  for (let i = 0; i < candidates.length; i++) {
    if (typeof candidates[i] === "string" && candidates[i]) return candidates[i];
  }
  return null;
}

function orgIdOf(entry) {
  if (typeof entry === "string") return entry;
  if (!isPlainObject(entry)) return null;
  const c = [entry.organizationId, entry.OrganizationId, entry.itemId, entry.ItemId, entry.id];
  for (let i = 0; i < c.length; i++) if (typeof c[i] === "string" && c[i]) return c[i];
  return null;
}

function rolesOf(entry) {
  if (!isPlainObject(entry)) return [];
  const raw = entry.roles || entry.Roles || entry.roleSlugs || [];
  return (Array.isArray(raw) ? raw : []).map(function (r) {
    return typeof r === "string" ? r : isPlainObject(r) ? r.slug || r.name || "" : "";
  }).filter(Boolean);
}

// Organization memberships as [{ organizationId, roles[] }].
function extractMemberships(response) {
  const v = iamPayload(response);
  const lists = [];
  if (Array.isArray(v)) lists.push(v);
  if (isPlainObject(v)) {
    ["items", "organizations", "memberships", "organizationRoles", "userOrganizations"].forEach(function (k) {
      if (Array.isArray(v[k])) lists.push(v[k]);
    });
  }
  const out = [];
  for (let i = 0; i < lists.length; i++) {
    for (let j = 0; j < lists[i].length; j++) {
      const id = orgIdOf(lists[i][j]);
      if (id) out.push({ organizationId: id, roles: rolesOf(lists[i][j]) });
    }
  }
  // A user record fetched with ?organizationId= may carry a single organizationId + roles.
  if (isPlainObject(v) && typeof v.organizationId === "string" && v.organizationId) {
    out.push({ organizationId: v.organizationId, roles: rolesOf(v) });
  }
  return out;
}

function membershipIn(response, orgId) {
  if (!orgId) return null;
  const list = extractMemberships(response);
  for (let i = 0; i < list.length; i++) if (list[i].organizationId === orgId) return list[i];
  return null;
}

function hasRole(membershipOrResponse, role) {
  const roles = membershipOrResponse && Array.isArray(membershipOrResponse.roles)
    ? membershipOrResponse.roles
    : rolesOf(iamPayload(membershipOrResponse));
  return roles.indexOf(role) >= 0;
}

function hourStartOf(iso) {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}
