import { handleUpdate } from "@/lib/bot";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleUpdate(request);
}

export async function GET(): Promise<Response> {
  return new Response("Telegram bot is running.");
}
