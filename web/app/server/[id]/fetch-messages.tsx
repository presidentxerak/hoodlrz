import prisma from "@/lib/prisma";

import DisplayChat from "./display-chat";
import ChatTopbar from "@/components/chat/chat-top-bar";

export default async function fetchMessages({ id }: { id: string }) {
  const server = await prisma.server.findUnique({
    where: {
      id: parseInt(id),
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        include: {
          user: true,
        },
      },
    },
  });

  if (!server) return <div>Server not found</div>;

  return (
    <div className="p-4 pt-16 w-full h-full">
      <div className="z-10 border rounded-lg max-w-5xl w-full h-full text-sm flex ">
        <div className="flex flex-col justify-between w-full h-full">
          <ChatTopbar name={server.name} />
          <DisplayChat messages={server?.messages} serverId={Number(id)} />
        </div>
      </div>
    </div>
  );
}
