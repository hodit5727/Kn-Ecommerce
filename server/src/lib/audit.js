/**
 * Audit log writer (§36 append-only trail).
 *
 * Writes go through the service-role client (the only privileged DB path).
 * An audit failure must NEVER silently disappear — it is logged loudly, but
 * it does not fail the request that triggered it (the primary action already
 * succeeded; the trail records it best-effort and operators see the error).
 */
export async function writeAudit(supabase, { actorId = null, actorRole = null, action, resourceType, resourceId = null, result = 'SUCCESS', ip = null, metadata = {} }) {
  try {
    const { error } = await supabase.service
      .from('audit_logs')
      .insert({
        actor_id: actorId,
        actor_role: actorRole,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        result,
        ip_address: ip,
        metadata,
      });
    if (error) throw error;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record', action, String(resourceId ?? ''), e && e.message ? e.message : e);
  }
}