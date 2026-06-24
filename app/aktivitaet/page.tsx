import Home from "@/app/page";

export const dynamic = "force-dynamic";

export default function AktivitaetPage() {
  return <Home searchParams={{ view: "activity" }} />;
}
