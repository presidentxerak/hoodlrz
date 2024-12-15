"use server";
import prisma from "@/lib/prisma";

export async function createUser(address: string) {
  try {
    const user = await prisma.user.findUnique({
      where: {
        evmAddress: address,
      },
    });

    if (user) return user;

    return await prisma.user.create({
      data: {
        evmAddress: address,
      },
    });
  } catch (error) {
    throw new Error(`Error creating user: ${error}`);
  } finally {
    await prisma.$disconnect();
  }
}
