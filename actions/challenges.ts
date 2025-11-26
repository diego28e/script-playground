"use server";

import { prisma } from "@/lib/prisma";
import { Difficulty } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function getChallenges(userId?: string) {
  try {
    const challenges = await prisma.challenge.findMany({
      orderBy: { order: "asc" },
      include: { labels: true },
    });

    if (!userId) {
      return {
        success: true,
        data: challenges.map((c) => ({ ...c, completed: false })),
      };
    }

    const completedChallengeIds = await prisma.submission.findMany({
      where: {
        userId,
        status: "PASSED",
      },
      select: {
        challengeId: true,
      },
      distinct: ["challengeId"],
    });

    const completedSet = new Set(
      completedChallengeIds.map((s) => s.challengeId)
    );

    const challengesWithStatus = challenges.map((challenge) => ({
      ...challenge,
      completed: completedSet.has(challenge.id),
    }));

    return { success: true, data: challengesWithStatus };
  } catch (error) {
    console.error("Failed to fetch challenges:", error);
    return { success: false, error: "Failed to fetch challenges" };
  }
}

export async function getChallenge(id: string) {
  try {
    const challenge = await prisma.challenge.findUnique({
      where: { id },
      include: { labels: true },
    });
    return { success: true, data: challenge };
  } catch (error) {
    console.error("Failed to fetch challenge:", error);
    return { success: false, error: "Failed to fetch challenge" };
  }
}

export async function getChallengeBySlug(slug: string, userId?: string) {
  try {
    const challenge = await prisma.challenge.findUnique({
      where: { slug },
      include: { labels: true },
    });

    if (!challenge) {
      return { success: true, data: null };
    }

    let completed = false;
    if (userId) {
      const submission = await prisma.submission.findFirst({
        where: {
          userId,
          challengeId: challenge.id,
          status: "PASSED",
        },
      });
      completed = !!submission;
    }

    const prevChallenge = await prisma.challenge.findFirst({
      where: { order: { lt: challenge.order } },
      orderBy: { order: "desc" },
      select: { slug: true },
    });

    const nextChallenge = await prisma.challenge.findFirst({
      where: { order: { gt: challenge.order } },
      orderBy: { order: "asc" },
      select: { slug: true },
    });

    return {
      success: true,
      data: {
        ...challenge,
        completed,
        prevSlug: prevChallenge?.slug,
        nextSlug: nextChallenge?.slug,
      },
    };
  } catch (error) {
    console.error("Failed to fetch challenge:", error);
    return { success: false, error: "Failed to fetch challenge" };
  }
}

export async function createChallenge(data: {
  title: string;
  slug: string;
  description: any;
  starterCode: string;
  solutionCode?: string;
  difficulty: Difficulty;
  labels: string[];
}) {
  try {
    const lastChallenge = await prisma.challenge.findFirst({
      orderBy: { order: "desc" },
    });
    const newOrder = (lastChallenge?.order ?? -1) + 1;

    const challenge = await prisma.challenge.create({
      data: {
        title: data.title,
        slug: data.slug,
        description: data.description,
        starterCode: data.starterCode,
        solutionCode: data.solutionCode,
        difficulty: data.difficulty,
        order: newOrder,
        labels: {
          connect: data.labels.map((id) => ({ id })),
        },
      },
    });
    revalidatePath("/admin/challenges");
    revalidatePath("/challenges");
    return { success: true, data: challenge };
  } catch (error) {
    console.error("Failed to create challenge:", error);
    return { success: false, error: "Failed to create challenge" };
  }
}

export async function updateChallenge(
  id: string,
  data: {
    title?: string;
    slug?: string;
    description?: any;
    starterCode?: string;
    solutionCode?: string;
    difficulty?: Difficulty;
    labels?: string[];
  }
) {
  try {
    const challenge = await prisma.challenge.update({
      where: { id },
      data: {
        ...data,
        labels: data.labels
          ? {
              set: [],
              connect: data.labels.map((labelId) => ({ id: labelId })),
            }
          : undefined,
      },
    });
    revalidatePath("/admin/challenges");
    revalidatePath("/challenges");
    revalidatePath(`/challenges/${challenge.slug}`);
    return { success: true, data: challenge };
  } catch (error) {
    console.error("Failed to update challenge:", error);
    return { success: false, error: "Failed to update challenge" };
  }
}

export async function deleteChallenge(id: string) {
  try {
    await prisma.challenge.delete({ where: { id } });
    revalidatePath("/admin/challenges");
    revalidatePath("/challenges");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete challenge:", error);
    return { success: false, error: "Failed to delete challenge" };
  }
}

export async function reorderChallenges(
  items: { id: string; order: number }[]
) {
  try {
    await prisma.$transaction(
      items.map((item) =>
        prisma.challenge.update({
          where: { id: item.id },
          data: { order: item.order },
        })
      )
    );
    revalidatePath("/admin/challenges");
    revalidatePath("/challenges");
    return { success: true };
  } catch (error) {
    console.error("Failed to reorder challenges:", error);
    return { success: false, error: "Failed to reorder challenges" };
  }
}

export async function getLabels() {
  try {
    const labels = await prisma.label.findMany({
      orderBy: { name: "asc" },
    });
    return { success: true, data: labels };
  } catch (error) {
    console.error("Failed to fetch labels:", error);
    return { success: false, error: "Failed to fetch labels" };
  }
}

export async function createLabel(name: string, color: string) {
  try {
    const label = await prisma.label.create({
      data: { name, color },
    });
    return { success: true, data: label };
  } catch (error) {
    console.error("Failed to create label:", error);
    return { success: false, error: "Failed to create label" };
  }
}
