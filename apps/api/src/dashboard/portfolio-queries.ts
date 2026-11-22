/**
 * One query runs under a single tenant's ordinary RLS context. Resolve the
 * service day the same way as reports, including shifts crossing midnight.
 * Lateral aggregates keep each patrol at one row before the daily rollup.
 */
export const PORTFOLIO_DAILY = `
  WITH dated AS (
    SELECT p.*, app_stats_service_day(p.scheduled_start_at, a.service_date, s.timezone) AS day
    FROM sites s
    JOIN patrols p ON p.tenant_id=s.tenant_id AND p.site_id=s.id
    LEFT JOIN shift_assignments a ON a.tenant_id=p.tenant_id AND a.id=p.shift_assignment_id
    WHERE s.tenant_id=app_tenant_id() AND s.is_active AND s.id=ANY($3::uuid[])
      AND p.scheduled_start_at >= (($1::date - 1)::timestamp AT TIME ZONE s.timezone)
      AND p.scheduled_start_at < (($2::date + 2)::timestamp AT TIME ZONE s.timezone)
  ), period AS (
    SELECT d.*, d.status IN ('completada','incompleta','vencida') AS closed
    FROM dated d WHERE d.day BETWEEN $1::date AND $2::date
  )
  SELECT p.site_id AS "siteId", p.day::text AS day,
    count(*)::int AS "patrols",
    count(*) FILTER (WHERE p.is_voluntary)::int AS "voluntary",
    count(*) FILTER (WHERE p.status='completada')::int AS "completed",
    count(*) FILTER (WHERE p.status='incompleta')::int AS "incomplete",
    count(*) FILTER (WHERE p.status='vencida')::int AS "expired",
    count(*) FILTER (WHERE p.status IN ('en_curso','pausada'))::int AS "active",
    count(*) FILTER (WHERE p.status='pendiente' AND p.scheduled_start_at<=now())::int AS "waiting",
    coalesce(sum(p.compliance_pct) FILTER (WHERE p.closed),0)::float8 AS "complianceSum",
    count(p.compliance_pct) FILTER (WHERE p.closed)::int AS "complianceCount",
    coalesce(sum(scan.total),0)::int AS "scans",
    coalesce(sum(scan.flagged),0)::int AS "scansFlagged",
    coalesce(sum(scan.nfc),0)::int AS "scansNfc",
    coalesce(sum(scan.gps),0)::int AS "scansWithGps",
    coalesce(sum(scan.accurate),0)::int AS "gpsAccuracyCount",
    coalesce(sum(scan.accuracy_sum),0)::float8 AS "gpsAccuracySum",
    coalesce(sum(task.expected),0)::int AS "tasksExpected",
    coalesce(sum(task.done),0)::int AS "tasksDone",
    coalesce(sum(task.failed),0)::int AS "tasksFailed",
    coalesce(sum(task.legacy),0)::int AS "legacyResponses"
  FROM period p
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE jsonb_array_length(s.anomalies)>0) AS flagged,
      count(*) FILTER (WHERE s.method='nfc') AS nfc,
      count(*) FILTER (WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL) AS gps,
      count(s.accuracy_m) FILTER (WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL) AS accurate,
      sum(s.accuracy_m) FILTER (WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL) AS accuracy_sum
    FROM scans s WHERE p.closed AND s.tenant_id=p.tenant_id AND s.patrol_id=p.id
  ) scan ON true
  LEFT JOIN LATERAL (
    SELECT count(i.id) AS expected,
      count(r.id) FILTER (WHERE i.id IS NOT NULL) AS done,
      count(r.id) FILTER (WHERE r.failed) AS failed,
      count(r.id) FILTER (WHERE i.id IS NULL) AS legacy
    FROM (
      SELECT item.id, item.tenant_id FROM checklist_items item
      WHERE p.closed AND item.tenant_id=p.tenant_id
        AND item.template_id=p.checklist_template_id
        AND (item.checkpoint_id IS NULL OR p.expected_checkpoint_ids ? item.checkpoint_id::text)
    ) i
    FULL JOIN (
      SELECT response.id, response.item_id, response.failed FROM checklist_responses response
      WHERE p.closed AND response.tenant_id=p.tenant_id AND response.patrol_id=p.id
    ) r ON i.id=r.item_id
  ) task ON true
  GROUP BY p.site_id,p.day
`;
