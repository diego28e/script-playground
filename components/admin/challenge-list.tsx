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

interface ChallengeListProps {
    initialChallenges: (Challenge & { labels: LabelType[] })[];
}

function SortableChallengeItem({ challenge }: { challenge: Challenge & { labels: LabelType[] } }) {
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
        if (confirm("Are you sure you want to delete this challenge?")) {
            const result = await deleteChallenge(challenge.id);
            if (result.success) {
                toast.success("Challenge deleted");
            } else {
                toast.error("Failed to delete challenge");
            }
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
                        <Link href={`/admin/challenges/${challenge.id}`}>
                            <Button variant="ghost" size="icon">
                                <Pencil className="h-4 w-4" />
                            </Button>
                        </Link>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={handleDelete}>
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
    const [, setIsSaving] = useState(false);

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
            setChallenges((items) => {
                const oldIndex = items.findIndex((item) => item.id === active.id);
                const newIndex = items.findIndex((item) => item.id === over.id);
                const newItems = arrayMove(items, oldIndex, newIndex);

                // Trigger save after reorder
                saveOrder(newItems);

                return newItems;
            });
        }
    };

    const saveOrder = async (items: typeof challenges) => {
        setIsSaving(true);
        const orderData = items.map((item, index) => ({
            id: item.id,
            order: index,
        }));

        try {
            await reorderChallenges(orderData);
            toast.success("Order updated");
        } catch {
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
                <div className="space-y-2">
                    {challenges.map((challenge) => (
                        <SortableChallengeItem key={challenge.id} challenge={challenge} />
                    ))}
                </div>
            </SortableContext>
        </DndContext>
    );
}
