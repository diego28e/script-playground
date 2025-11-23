"use server";

import { supabase } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

type SubmissionStatus = "PENDING" | "PASSED" | "FAILED";

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

        const { data: submission, error } = await supabase
            .from("submission")
            .insert({
                userId: session.user.id,
                challengeId: data.challengeId,
                code: data.code,
                status: data.status,
                output: data.output || null,
                error: data.error || null,
            })
            .select()
            .single();

        if (error) throw error;

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

        const { data: submissions, error } = await supabase
            .from("submission")
            .select("*")
            .eq("userId", session.user.id)
            .eq("challengeId", challengeId)
            .order("createdAt", { ascending: false })
            .limit(10);

        if (error) throw error;

        return { success: true, data: submissions };
    } catch (error) {
        console.error("Failed to fetch submissions:", error);
        return { success: false, error: "Failed to fetch submissions" };
    }
}
