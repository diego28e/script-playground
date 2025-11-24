import { getChallenges } from "@/actions/challenges";
import { ChallengeList } from "@/components/admin/challenge-list";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";

export const runtime = 'nodejs';

export default async function AdminChallengesPage() {
    const { data: challenges } = await getChallenges();

    return (
        <div className="h-full flex-1 flex-col space-y-8 p-8 md:flex">
            <div className="flex items-center justify-between space-y-2">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Challenges</h2>
                    <p className="text-muted-foreground">
                        Manage your coding challenges here. Drag to reorder.
                    </p>
                </div>
                <div className="flex items-center space-x-2">
                    <Link href="/admin/challenges/new">
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            New Challenge
                        </Button>
                    </Link>
                </div>
            </div>
            <div className="space-y-4">
                {challenges && <ChallengeList initialChallenges={challenges} />}
                {(!challenges || challenges.length === 0) && (
                    <div className="text-center py-10 text-muted-foreground">
                        No challenges found. Create your first one!
                    </div>
                )}
            </div>
        </div>
    );
}
