import { networkInterfaces } from "os";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const nets = networkInterfaces();
  const skip = /virtual|vethernet|vmware|docker|wsl|hyper-v|loopback/i;
  const ips: string[] = [];
  for (const name of Object.keys(nets)) {
    if (skip.test(name)) continue;
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return NextResponse.json({ ips });
}
