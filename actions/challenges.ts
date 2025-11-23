"use server";

import { prisma } from "@/lib/prisma";
import { Challenge, Difficulty, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function getChallenges() {
    try {
        const challenges = await prisma.challenge.findMany({
            orderBy: {
                order: "asc",
            },
            include: {
                labels: true,
            },
        });
        return { success: true, data: challenges };
    } catch (error) {
        console.error("Failed to fetch challenges:", error);
        return { success: false, error: "Failed to fetch challenges" };
    }
}

export async function getChallenge(id: string) {
    try {
        const challenge = await prisma.challenge.findUnique({
            where: { id },
            include: {
                labels: true,
            },
        });
        return { success: true, data: challenge };
    } catch (error) {
        console.error("Failed to fetch challenge:", error);
        return { success: false, error: "Failed to fetch challenge" };
    }
}

export async function createChallenge(data: {
    title: string;
    slug: string;
    description: string;
    starterCode: string;
    solutionCode?: string;
    difficulty: Difficulty;
    labels: string[]; // Array of label IDs
}) {
    try {
        // Get the highest order to append to the end
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
        description?: string;
        starterCode?: string;
        solutionCode?: string;
        difficulty?: Difficulty;
        labels?: string[]; // Array of label IDs
    }
) {
    try {
        const updateData: Prisma.ChallengeUpdateInput = {
            ...data,
            labels: data.labels
                ? {
                    set: [], // Clear existing relations
                    connect: data.labels.map((labelId) => ({ id: labelId })),
                }
                : undefined,
        };

        const challenge = await prisma.challenge.update({
            where: { id },
            data: updateData,
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
        await prisma.challenge.delete({
            where: { id },
        });
        revalidatePath("/admin/challenges");
        revalidatePath("/challenges");
        return { success: true };
    } catch (error) {
        console.error("Failed to delete challenge:", error);
        return { success: false, error: "Failed to delete challenge" };
    }
}

export async function reorderChallenges(items: { id: string; order: number }[]) {
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
