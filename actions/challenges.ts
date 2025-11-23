"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

type Difficulty = "EASY" | "MEDIUM" | "HARD";

export async function getChallenges() {
    try {
        const { data: challenges, error } = await supabase
            .from("challenge")
            .select(`
                *,
                labels:_ChallengeToLabel(label:label(*))
            `)
            .order("order", { ascending: true });

        if (error) throw error;

        const formatted = challenges?.map((c: any) => ({
            ...c,
            labels: c.labels?.map((l: any) => l.label) || []
        }));

        return { success: true, data: formatted };
    } catch (error) {
        console.error("Failed to fetch challenges:", error);
        return { success: false, error: "Failed to fetch challenges" };
    }
}

export async function getChallenge(id: string) {
    try {
        const { data: challenge, error } = await supabase
            .from("challenge")
            .select(`
                *,
                labels:_ChallengeToLabel(label:label(*))
            `)
            .eq("id", id)
            .single();

        if (error) throw error;

        const formatted = challenge ? {
            ...(challenge as any),
            labels: (challenge as any).labels?.map((l: any) => l.label) || []
        } : null;

        return { success: true, data: formatted };
    } catch (error) {
        console.error("Failed to fetch challenge:", error);
        return { success: false, error: "Failed to fetch challenge" };
    }
}

export async function getChallengeBySlug(slug: string) {
    try {
        const { data: challenge, error } = await supabase
            .from("challenge")
            .select(`
                *,
                labels:_ChallengeToLabel(label:label(*))
            `)
            .eq("slug", slug)
            .single();

        if (error) throw error;

        const formatted = challenge ? {
            ...(challenge as any),
            labels: (challenge as any).labels?.map((l: any) => l.label) || []
        } : null;

        return { success: true, data: formatted };
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
    labels: string[];
}) {
    try {
        const { data: lastChallenge } = await supabase
            .from("challenge")
            .select("order")
            .order("order", { ascending: false })
            .limit(1)
            .maybeSingle();

        const newOrder = ((lastChallenge as any)?.order ?? -1) + 1;

        const { data: challenge, error } = await supabase
            .from("challenge")
            .insert({
                title: data.title,
                slug: data.slug,
                description: data.description,
                starterCode: data.starterCode,
                solutionCode: data.solutionCode || null,
                difficulty: data.difficulty,
                order: newOrder,
            })
            .select()
            .single();

        if (error) throw error;

        if (data.labels.length > 0 && challenge) {
            await supabase.from("_ChallengeToLabel").insert(
                data.labels.map(labelId => ({
                    A: challenge.id,
                    B: labelId
                }))
            );
        }

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
        labels?: string[];
    }
) {
    try {
        const { labels, ...updateData } = data;

        const { data: challenge, error } = await supabase
            .from("challenge")
            .update(updateData)
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;

        if (labels !== undefined) {
            await supabase.from("_ChallengeToLabel").delete().eq("A", id);
            if (labels.length > 0) {
                await supabase.from("_ChallengeToLabel").insert(
                    labels.map(labelId => ({ A: id, B: labelId }))
                );
            }
        }

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
        const { error } = await supabase
            .from("challenge")
            .delete()
            .eq("id", id);

        if (error) throw error;

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
        for (const item of items) {
            await supabase
                .from("challenge")
                .update({ order: item.order })
                .eq("id", item.id);
        }
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
        const { data: labels, error } = await supabase
            .from("label")
            .select("*")
            .order("name", { ascending: true });

        if (error) throw error;

        return { success: true, data: labels };
    } catch (error) {
        console.error("Failed to fetch labels:", error);
        return { success: false, error: "Failed to fetch labels" };
    }
}

export async function createLabel(name: string, color: string) {
    try {
        const { data: label, error } = await supabase
            .from("label")
            .insert({ name, color })
            .select()
            .single();

        if (error) throw error;

        return { success: true, data: label };
    } catch (error) {
        console.error("Failed to create label:", error);
        return { success: false, error: "Failed to create label" };
    }
}
