export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request): Promise<Response> {
  const { handleUpdate } = await import("@/lib/bot");
  return handleUpdate(request);
}

export async function GET(): Promise<Response> {
  return new Response("Telegram bot is running.");
}
