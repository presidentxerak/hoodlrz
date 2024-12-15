"use sercer";
import prisma from "@/lib/prisma";

export async function fetchServerMessages(serverId: number) {
  try {
    return await prisma.server.findUnique({
      where: {
        id: serverId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          include: {
            user: true,
          },
        },
      },
    });
  } catch (error) {
    throw new Error(`Error fetching messages: ${error}`);
  } finally {
    await prisma.$disconnect();
  }
}
