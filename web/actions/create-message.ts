"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function createMessage(
  serverId: number,
  content: string,
  userAddress: string
) {
  try {
    const user = await prisma.user.findUnique({
      where: {
        evmAddress: userAddress,
      },
    });
    if (!user) {
      throw new Error("User not found");
    }
    const message = await prisma.message.create({
      data: {
        content,
        serverId,
        userId: user?.id,
      },
    });
    revalidatePath(`/server/${serverId}`);
    return message;
  } catch (error) {
    throw new Error(`Error creating message: ${error}`);
  } finally {
    await prisma.$disconnect();
  }
}
