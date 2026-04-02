// GET /api/auth - Get radiko auth token and area info
import { getRadikoAuth } from "@/lib/radiko-auth";

export async function GET() {
  try {
    const auth = await getRadikoAuth();
    return Response.json(auth);
  } catch (e) {
    const message = e instanceof Error ? e.message : "auth failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
