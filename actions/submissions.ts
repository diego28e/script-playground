"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { SubmissionStatus } from "@prisma/client";

export async function createSubmission(data: {
    challengeId: string;
    code: string;
    status: SubmissionStatus;
    output?: string;
    error?: string;
}) {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });

        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const submission = await prisma.submission.create({
            data: {
                userId: session.user.id,
                challengeId: data.challengeId,
                code: data.code,
                status: data.status,
                output: data.output,
                error: data.error,
            },
        });

        return { success: true, data: submission };
    } catch (error) {
        console.error("Failed to create submission:", error);
        return { success: false, error: "Failed to save submission" };
    }
}

export async function getUserSubmissions(challengeId: string) {
    try {
        const session = await auth.api.getSession({
            headers: await headers(),
        });

        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const submissions = await prisma.submission.findMany({
            where: {
                userId: session.user.id,
                challengeId,
            },
            orderBy: {
                createdAt: "desc",
            },
            take: 10,
        });

        return { success: true, data: submissions };
    } catch (error) {
        console.error("Failed to fetch submissions:", error);
        return { success: false, error: "Failed to fetch submissions" };
    }
}
