import pg from "pg";

const { Pool } = pg;

const asIso = (value) => {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

export async function createHermesDb(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: String(process.env.DATABASE_SSL || "").toLowerCase() === "off"
      ? false
      : { rejectUnauthorized: false }
  });

  await pool.query(`
    create table if not exists hermes_track_points (
      id bigserial primary key,
      t timestamptz not null,
      lat double precision not null,
      lon double precision not null,
      acc integer,
      gps timestamptz,
      src text
    );
  `);
  await pool.query("create index if not exists hermes_track_points_t_idx on hermes_track_points (t);");

  await pool.query(`
    create table if not exists hermes_location_feed (
      id bigserial primary key,
      at timestamptz not null,
      reported_at timestamptz,
      source text not null,
      name text,
      lat double precision not null,
      lon double precision not null,
      accuracy_m integer,
      gps_timestamp timestamptz,
      ip text,
      method text,
      user_agent text,
      accepted boolean not null,
      test boolean not null default false,
      reason text,
      track_point_logged boolean
    );
  `);
  await pool.query("create index if not exists hermes_location_feed_at_idx on hermes_location_feed (at);");

  await pool.query(`
    create table if not exists hermes_pickup_requests (
      id text primary key,
      at timestamptz not null,
      who text,
      place text,
      pickup_when text,
      pickup_at timestamptz,
      request_type text,
      intention text,
      equipment_needed text,
      approval_status text,
      approved_by text,
      approved_at timestamptz,
      lat double precision,
      lon double precision,
      note text,
      source text,
      ip text
    );
  `);
  await pool.query("create index if not exists hermes_pickup_requests_at_idx on hermes_pickup_requests (at);");
  await pool.query("alter table hermes_pickup_requests add column if not exists approval_status text;");
  await pool.query("alter table hermes_pickup_requests add column if not exists approved_by text;");
  await pool.query("alter table hermes_pickup_requests add column if not exists approved_at timestamptz;");
  await pool.query(`
    create table if not exists hermes_people_graph_events (
      id text primary key,
      at timestamptz not null,
      event_type text not null,
      person text,
      from_person text,
      to_person text,
      kind text,
      severity text,
      severity_rank integer,
      note text,
      request_id text,
      request_type text,
      place text,
      reported_by text,
      source text,
      ip text
    );
  `);
  await pool.query("create index if not exists hermes_people_graph_events_at_idx on hermes_people_graph_events (at);");
  await pool.query("alter table hermes_people_graph_events add column if not exists severity_rank integer;");

  return {
    async close() {
      await pool.end();
    },
    async loadTrack(limit) {
      const n = Math.max(1, Number(limit) || 20000);
      const { rows } = await pool.query(
        `select t, lat, lon, acc, gps, src
         from hermes_track_points
         order by t desc
         limit $1`,
        [n]
      );
      return rows.reverse().map((row) => ({
        t: new Date(row.t).toISOString(),
        lat: Number(row.lat),
        lon: Number(row.lon),
        ...(Number.isFinite(Number(row.acc)) ? { acc: Number(row.acc) } : {}),
        ...(row.gps ? { gps: new Date(row.gps).toISOString() } : {}),
        ...(row.src ? { src: String(row.src) } : {})
      }));
    },
    async saveTrackPoint(point) {
      await pool.query(
        `insert into hermes_track_points (t, lat, lon, acc, gps, src)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          asIso(point.t) || new Date().toISOString(),
          Number(point.lat),
          Number(point.lon),
          Number.isFinite(Number(point.acc)) ? Number(point.acc) : null,
          asIso(point.gps),
          point.src || null
        ]
      );
    },
    async loadLocationFeed(limit) {
      const n = Math.max(1, Number(limit) || 50000);
      const { rows } = await pool.query(
        `select at, reported_at, source, name, lat, lon, accuracy_m, gps_timestamp, ip, method, user_agent,
                accepted, test, reason, track_point_logged
         from hermes_location_feed
         order by at desc
         limit $1`,
        [n]
      );
      return rows.reverse().map((row) => ({
        at: new Date(row.at).toISOString(),
        reportedAt: row.reported_at ? new Date(row.reported_at).toISOString() : null,
        source: row.source,
        name: row.name || null,
        lat: Number(row.lat),
        lon: Number(row.lon),
        accuracyM: Number.isFinite(Number(row.accuracy_m)) ? Number(row.accuracy_m) : null,
        gpsTimestamp: row.gps_timestamp ? new Date(row.gps_timestamp).toISOString() : null,
        ip: row.ip || "",
        method: row.method || "",
        userAgent: row.user_agent || "",
        accepted: Boolean(row.accepted),
        test: Boolean(row.test),
        reason: row.reason || null,
        trackPointLogged: row.track_point_logged == null ? null : Boolean(row.track_point_logged)
      }));
    },
    async saveLocationFeed(entry) {
      await pool.query(
        `insert into hermes_location_feed
         (at, reported_at, source, name, lat, lon, accuracy_m, gps_timestamp, ip, method, user_agent,
          accepted, test, reason, track_point_logged)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          asIso(entry.at) || new Date().toISOString(),
          asIso(entry.reportedAt),
          entry.source || "unknown",
          entry.name || null,
          Number(entry.lat),
          Number(entry.lon),
          Number.isFinite(Number(entry.accuracyM)) ? Number(entry.accuracyM) : null,
          asIso(entry.gpsTimestamp),
          entry.ip || "",
          entry.method || "",
          entry.userAgent || "",
          Boolean(entry.accepted),
          Boolean(entry.test),
          entry.reason || null,
          entry.trackPointLogged == null ? null : Boolean(entry.trackPointLogged)
        ]
      );
    },
    async loadPickups(limit) {
      const n = Math.max(1, Number(limit) || 80);
      const { rows } = await pool.query(
        `select id, at, who, place, pickup_when, pickup_at, request_type, intention, equipment_needed,
                approval_status, approved_by, approved_at,
                lat, lon, note, source, ip
         from hermes_pickup_requests
         order by at desc
         limit $1`,
        [n]
      );
      return rows.reverse().map((row) => ({
        id: row.id,
        at: new Date(row.at).toISOString(),
        who: row.who || "",
        place: row.place || "",
        pickupWhen: row.pickup_when || "",
        pickupAt: row.pickup_at ? new Date(row.pickup_at).toISOString() : null,
        requestType: row.request_type || "pickup",
        intention: row.intention || "",
        equipmentNeeded: row.equipment_needed || "",
        approvalStatus: row.approval_status || "",
        approvedBy: row.approved_by || "",
        approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
        lat: Number.isFinite(Number(row.lat)) ? Number(row.lat) : NaN,
        lon: Number.isFinite(Number(row.lon)) ? Number(row.lon) : NaN,
        note: row.note || "",
        source: row.source || "",
        ip: row.ip || ""
      }));
    },
    async savePickup(request) {
      await pool.query(
        `insert into hermes_pickup_requests
          (id, at, who, place, pickup_when, pickup_at, request_type, intention, equipment_needed,
           approval_status, approved_by, approved_at, lat, lon, note, source, ip)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         on conflict (id) do update set
          at=excluded.at, who=excluded.who, place=excluded.place, pickup_when=excluded.pickup_when,
          pickup_at=excluded.pickup_at, request_type=excluded.request_type, intention=excluded.intention,
          equipment_needed=excluded.equipment_needed, approval_status=excluded.approval_status,
          approved_by=excluded.approved_by, approved_at=excluded.approved_at, lat=excluded.lat, lon=excluded.lon,
          note=excluded.note, source=excluded.source, ip=excluded.ip`,
        [
          request.id,
          asIso(request.at) || new Date().toISOString(),
          request.who || "",
          request.place || "",
          request.pickupWhen || "",
          asIso(request.pickupAt),
          request.requestType || "pickup",
          request.intention || "",
          request.equipmentNeeded || "",
          request.approvalStatus || null,
          request.approvedBy || null,
          asIso(request.approvedAt),
          Number.isFinite(Number(request.lat)) ? Number(request.lat) : null,
          Number.isFinite(Number(request.lon)) ? Number(request.lon) : null,
          request.note || "",
          request.source || "",
          request.ip || ""
        ]
      );
    },
    async loadPeopleGraphEvents(limit) {
      const n = Math.max(1, Number(limit) || 2000);
      const { rows } = await pool.query(
        `select id, at, event_type, person, from_person, to_person, kind, severity, severity_rank, note,
                request_id, request_type, place, reported_by, source, ip
         from hermes_people_graph_events
         order by at desc
         limit $1`,
        [n]
      );
      return rows.reverse().map((row) => ({
        id: row.id,
        at: new Date(row.at).toISOString(),
        type: row.event_type || "note",
        person: row.person || "",
        fromPerson: row.from_person || "",
        toPerson: row.to_person || "",
        kind: row.kind || "",
        severity: row.severity || "",
        severityRank: Number.isFinite(Number(row.severity_rank)) ? Number(row.severity_rank) : null,
        note: row.note || "",
        requestId: row.request_id || "",
        requestType: row.request_type || "",
        place: row.place || "",
        by: row.reported_by || "",
        source: row.source || "",
        ip: row.ip || ""
      }));
    },
    async savePeopleGraphEvent(entry) {
      await pool.query(
        `insert into hermes_people_graph_events
          (id, at, event_type, person, from_person, to_person, kind, severity, severity_rank, note,
           request_id, request_type, place, reported_by, source, ip)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (id) do update set
           at=excluded.at, event_type=excluded.event_type, person=excluded.person,
           from_person=excluded.from_person, to_person=excluded.to_person, kind=excluded.kind,
           severity=excluded.severity, severity_rank=excluded.severity_rank, note=excluded.note, request_id=excluded.request_id,
           request_type=excluded.request_type, place=excluded.place, reported_by=excluded.reported_by,
           source=excluded.source, ip=excluded.ip`,
        [
          entry.id,
          asIso(entry.at) || new Date().toISOString(),
          entry.type || "note",
          entry.person || "",
          entry.fromPerson || "",
          entry.toPerson || "",
          entry.kind || "",
          entry.severity || "",
          Number.isFinite(Number(entry.severityRank)) ? Number(entry.severityRank) : null,
          entry.note || "",
          entry.requestId || "",
          entry.requestType || "",
          entry.place || "",
          entry.by || "",
          entry.source || "",
          entry.ip || ""
        ]
      );
    }
  };
}
