"use client";

import { useState, useEffect } from "react";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Challenge, Label as LabelType } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { deleteChallenge, reorderChallenges } from "@/actions/challenges";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DotLoader } from "@/components/ui/dot-loader";

interface ChallengeListProps {
    initialChallenges: (Challenge & { labels: LabelType[] })[];
}

function SortableChallengeItem({
    challenge,
    onDeleted,
}: {
    challenge: Challenge & { labels: LabelType[] };
    onDeleted: (id: string) => void;
}) {
    const [deleting, setDeleting] = useState(false);
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: challenge.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : 0,
        opacity: isDragging ? 0.5 : 1,
    };

    const handleDelete = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (deleting || !confirm(`Delete "${challenge.title}"? This can't be undone.`)) return;
        setDeleting(true);
        try {
            const result = await deleteChallenge(challenge.id);
            if (!result.success) throw new Error(result.error);
            onDeleted(challenge.id);
            toast.success("Challenge deleted");
        } catch {
            toast.error("Failed to delete challenge");
            setDeleting(false);
        }
    };

    return (
        <div ref={setNodeRef} style={style} className="mb-2">
            <Card className={cn("bg-card hover:bg-accent/5 transition-colors", isDragging && "border-primary")}>
                <CardContent className="p-4 flex items-center gap-4">
                    <div
                        {...attributes}
                        {...listeners}
                        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
                    >
                        <GripVertical className="h-5 w-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium truncate">{challenge.title}</h3>
                            <Badge variant={
                                challenge.difficulty === "EASY" ? "secondary" :
                                    challenge.difficulty === "MEDIUM" ? "default" : "destructive"
                            }>
                                {challenge.difficulty}
                            </Badge>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {challenge.labels.map(label => (
                                <span key={label.id} className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                    {label.name}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button asChild variant="ghost" size="icon">
                            <Link href={`/admin/challenges/${challenge.id}`} aria-label={`Edit ${challenge.title}`}>
                                <Pencil className="h-4 w-4" />
                            </Link>
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={handleDelete}
                            loading={deleting}
                            aria-label={`Delete ${challenge.title}`}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export function ChallengeList({ initialChallenges }: ChallengeListProps) {
    const [challenges, setChallenges] = useState(initialChallenges);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setChallenges(initialChallenges);
    }, [initialChallenges]);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            // Compute the new order here, not inside a state updater: React may run the updater later,
            // and the save below needs the list now.
            const previous = challenges;
            const oldIndex = previous.findIndex((item) => item.id === active.id);
            const newIndex = previous.findIndex((item) => item.id === over.id);
            const reordered = arrayMove(previous, oldIndex, newIndex);
            setChallenges(reordered);
            saveOrder(reordered, previous);
        }
    };

    const saveOrder = async (items: typeof challenges, previous: typeof challenges) => {
        setIsSaving(true);
        const orderData = items.map((item, index) => ({
            id: item.id,
            order: index,
        }));

        try {
            const result = await reorderChallenges(orderData);
            if (!result.success) throw new Error(result.error);
            toast.success("Order updated");
        } catch {
            setChallenges(previous);
            toast.error("Failed to update order");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
        >
            <SortableContext
                items={challenges.map(c => c.id)}
                strategy={verticalListSortingStrategy}
            >
                <div className="space-y-2" aria-busy={isSaving || undefined}>
                    {isSaving && (
                        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                            <DotLoader size={14} />
                            Saving order…
                        </p>
                    )}
                    {challenges.map((challenge) => (
                        <SortableChallengeItem
                            key={challenge.id}
                            challenge={challenge}
                            onDeleted={(id) => setChallenges((items) => items.filter((item) => item.id !== id))}
                        />
                    ))}
                </div>
            </SortableContext>
        </DndContext>
    );
}
