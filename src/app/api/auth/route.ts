// GET /api/auth - Warm auth cache and return resolved area info
import { getRadikoAuth } from "@/lib/radiko-auth";

export async function GET() {
  try {
    const auth = await getRadikoAuth();
    return Response.json({ areaId: auth.areaId, ready: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "auth failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
