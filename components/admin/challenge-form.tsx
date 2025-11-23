"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Challenge, Difficulty, Label as LabelType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Editor } from "@monaco-editor/react";
import { toast } from "sonner";
import { createChallenge, updateChallenge, createLabel, getLabels } from "@/actions/challenges";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";

interface ChallengeFormProps {
    initialData?: Challenge & { labels: LabelType[] };
    isEditing?: boolean;
}

export function ChallengeForm({ initialData, isEditing = false }: ChallengeFormProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [availableLabels, setAvailableLabels] = useState<LabelType[]>([]);

    const [formData, setFormData] = useState({
        title: initialData?.title || "",
        slug: initialData?.slug || "",
        description: initialData?.description || "",
        starterCode: initialData?.starterCode || "// Write your code here\n",
        solutionCode: initialData?.solutionCode || "",
        difficulty: initialData?.difficulty || "EASY" as Difficulty,
        labels: initialData?.labels.map(l => l.id) || [] as string[],
    });

    const [newLabelName, setNewLabelName] = useState("");

    useEffect(() => {
        fetchLabels();
    }, []);

    const fetchLabels = async () => {
        const result = await getLabels();
        if (result.success && result.data) {
            setAvailableLabels(result.data);
        }
    };

    const handleCreateLabel = async () => {
        if (!newLabelName.trim()) return;

        // Simple random color generator for now
        const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        const result = await createLabel(newLabelName, randomColor);
        if (result.success && result.data) {
            setAvailableLabels([...availableLabels, result.data]);
            setFormData(prev => ({ ...prev, labels: [...prev.labels, result.data!.id] }));
            setNewLabelName("");
            toast.success("Label created");
        } else {
            toast.error("Failed to create label");
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            if (isEditing && initialData) {
                const result = await updateChallenge(initialData.id, formData);
                if (result.success) {
                    toast.success("Challenge updated successfully");
                    router.push("/admin/challenges");
                } else {
                    toast.error(result.error as string);
                }
            } else {
                const result = await createChallenge(formData);
                if (result.success) {
                    toast.success("Challenge created successfully");
                    router.push("/admin/challenges");
                } else {
                    toast.error(result.error as string);
                }
            }
        } catch {
            toast.error("Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    const toggleLabel = (labelId: string) => {
        setFormData(prev => {
            const labels = prev.labels.includes(labelId)
                ? prev.labels.filter(id => id !== labelId)
                : [...prev.labels, labelId];
            return { ...prev, labels };
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-8 max-w-4xl mx-auto pb-10">
            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                        id="title"
                        value={formData.title}
                        onChange={(e) => {
                            const title = e.target.value;
                            // Auto-generate slug if not editing or if slug was matching title
                            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
                            setFormData(prev => ({ ...prev, title, slug: isEditing ? prev.slug : slug }));
                        }}
                        required
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="slug">Slug</Label>
                    <Input
                        id="slug"
                        value={formData.slug}
                        onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                        required
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <RichTextEditor
                    value={formData.description}
                    onChange={(value) => setFormData({ ...formData, description: value })}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="difficulty">Difficulty</Label>
                    <Select
                        value={formData.difficulty}
                        onValueChange={(value) => setFormData({ ...formData, difficulty: value as Difficulty })}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select difficulty" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="EASY">Easy</SelectItem>
                            <SelectItem value="MEDIUM">Medium</SelectItem>
                            <SelectItem value="HARD">Hard</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-2">
                    <Label>Labels</Label>
                    <div className="flex flex-wrap gap-2 mb-2">
                        {formData.labels.map(labelId => {
                            const label = availableLabels.find(l => l.id === labelId);
                            if (!label) return null;
                            return (
                                <Badge key={label.id} variant="secondary" className="gap-1">
                                    {label.name}
                                    <X
                                        className="h-3 w-3 cursor-pointer hover:text-destructive"
                                        onClick={() => toggleLabel(label.id)}
                                    />
                                </Badge>
                            );
                        })}
                    </div>
                    <div className="flex gap-2">
                        <Select onValueChange={toggleLabel}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Add existing label..." />
                            </SelectTrigger>
                            <SelectContent>
                                {availableLabels
                                    .filter(l => !formData.labels.includes(l.id))
                                    .map(label => (
                                        <SelectItem key={label.id} value={label.id}>
                                            {label.name}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                        <div className="flex gap-2 min-w-[200px]">
                            <Input
                                placeholder="New label..."
                                value={newLabelName}
                                onChange={(e) => setNewLabelName(e.target.value)}
                            />
                            <Button type="button" size="icon" onClick={handleCreateLabel} disabled={!newLabelName}>
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <Label>Starter Code</Label>
                <div className="h-[300px] border rounded-md overflow-hidden">
                    <Editor
                        height="100%"
                        defaultLanguage="javascript"
                        theme="vs-dark"
                        value={formData.starterCode}
                        onChange={(value) => setFormData({ ...formData, starterCode: value || "" })}
                        options={{ minimap: { enabled: false } }}
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label>Solution Code (Hidden from user)</Label>
                <div className="h-[300px] border rounded-md overflow-hidden">
                    <Editor
                        height="100%"
                        defaultLanguage="javascript"
                        theme="vs-dark"
                        value={formData.solutionCode}
                        onChange={(value) => setFormData({ ...formData, solutionCode: value || "" })}
                        options={{ minimap: { enabled: false } }}
                    />
                </div>
            </div>

            <div className="flex justify-end gap-4">
                <Button type="button" variant="outline" onClick={() => router.back()}>
                    Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                    {loading ? "Saving..." : isEditing ? "Update Challenge" : "Create Challenge"}
                </Button>
            </div>
        </form>
    );
}
