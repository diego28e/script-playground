import { getChallenge } from "@/actions/challenges";
import { ChallengeForm } from "@/components/admin/challenge-form";
import { notFound } from "next/navigation";

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function EditChallengePage({ params }: PageProps) {
    const { id } = await params;
    const { data: challenge } = await getChallenge(id);

    if (!challenge) {
        notFound();
    }

    return (
        <div className="h-full flex-1 flex-col space-y-8 p-8 md:flex">
            <div className="flex items-center justify-between space-y-2">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Edit Challenge</h2>
                    <p className="text-muted-foreground">
                        Update existing challenge details.
                    </p>
                </div>
            </div>
            <ChallengeForm initialData={challenge} isEditing />
        </div>
    );
}
