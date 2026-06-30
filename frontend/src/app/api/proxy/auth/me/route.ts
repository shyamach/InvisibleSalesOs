import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${BACKEND}/api/auth/me`, {
    headers: {
      Authorization: authHeader,
      "x-internal-key": process.env.INTERNAL_API_KEY || "",
    },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
