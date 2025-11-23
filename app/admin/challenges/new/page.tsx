import { ChallengeForm } from "@/components/admin/challenge-form";

export default function NewChallengePage() {
    return (
        <div className="h-full flex-1 flex-col space-y-8 p-8 md:flex">
            <div className="flex items-center justify-between space-y-2">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Create Challenge</h2>
                    <p className="text-muted-foreground">
                        Add a new coding challenge for users to solve.
                    </p>
                </div>
            </div>
            <ChallengeForm />
        </div>
    );
}
