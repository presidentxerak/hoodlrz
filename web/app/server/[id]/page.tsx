import FetchMessages from "./fetch-messages";
import { Suspense } from "react";
export const dynamic = "force-dynamic";

export default async function ServerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <FetchMessages id={id} />
    </Suspense>
  );
}
