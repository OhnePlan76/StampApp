import Home from "@/app/page";

export const dynamic = "force-dynamic";

export default function ErfassenPage() {
  return <Home searchParams={{ view: "create" }} />;
}
