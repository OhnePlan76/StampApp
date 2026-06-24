import Home from "@/app/page";

export const dynamic = "force-dynamic";

type SammlungPageProps = {
  searchParams?: Promise<{ q?: string }> | { q?: string };
};

export default async function SammlungPage({ searchParams }: SammlungPageProps) {
  const params = searchParams ? await searchParams : {};

  return <Home searchParams={{ ...params, view: "albums" }} />;
}
