import Svg from "@/public/xerak0_Create_a_battered_colorful_isometric_minimalistic_illu_6a883a6a-189f-40af-927a-58e9fb1ef0e7_1 2.svg";
import prisma from "@/lib/prisma";
import ServerSelect from "@/components/server-select";

export default async function Home() {
  const servers = await prisma.server.findMany({
    include: {
      messages: true,
    },
  });

  console.log(servers);

  return (
    <div className="w-full h-full flex justify-center items-center p-4 pt-16 space-x-6 flex-col sm:flex-row">
      <Svg className="" />
      <ServerSelect
        servers={servers.map((server) => ({
          id: server.id,
          name: server.name,
        }))}
      />
    </div>
  );
}
