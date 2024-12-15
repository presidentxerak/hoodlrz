"use server";
import prisma from "@/lib/prisma";

export async function createServer(id: number) {
  try {
    const server = await prisma.server.findUnique({
      where: {
        id: id,
      },
    });

    if (server) return server;

    return await prisma.server.create({
      data: {
        id: id,
        name: `Server ${id}`,
      },
    });
  } catch (error) {
    throw new Error(`Error creating server: ${error}`);
  } finally {
    await prisma.$disconnect();
  }
}
