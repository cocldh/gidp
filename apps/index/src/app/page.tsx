import { redirect } from "next/navigation";
import { getServerProjectId } from "@/lib/supabase-server";
import HomeClient from "./HomeClient";

export default async function Page() {
  const projectId = await getServerProjectId();
  if (!projectId) redirect("/project");
  return <HomeClient projectId={projectId} />;
}
