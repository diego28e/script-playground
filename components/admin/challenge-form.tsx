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
import {
  createChallenge,
  updateChallenge,
  createLabel,
  getLabels,
} from "@/actions/challenges";
import { translateContent } from "@/actions/ai";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Sparkles, Loader2 } from "lucide-react";

interface ChallengeFormProps {
  initialData?: Challenge & { labels: LabelType[] };
  isEditing?: boolean;
}

export function ChallengeForm({
  initialData,
  isEditing = false,
}: ChallengeFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [availableLabels, setAvailableLabels] = useState<LabelType[]>([]);

  const [activeTab, setActiveTab] = useState<"en" | "es">("en");
  const [isTranslating, setIsTranslating] = useState(false);

  const getInitialDescription = () => {
    const desc = initialData?.description as any;
    if (!desc) return { en: "", es: "" };

    if (typeof desc === "string") {
      try {
        const parsed = JSON.parse(desc);
        if (typeof parsed === "object" && parsed !== null) {
          return { en: parsed.en || "", es: parsed.es || "" };
        }
        return { en: desc, es: "" };
      } catch {
        return { en: desc, es: "" };
      }
    }

    return { en: desc.en || "", es: desc.es || "" };
  };

  const [formData, setFormData] = useState({
    title: initialData?.title || "",
    slug: initialData?.slug || "",
    description: getInitialDescription(),
    starterCode: initialData?.starterCode || "// Write your code here\n",
    solutionCode: initialData?.solutionCode || "",
    difficulty: initialData?.difficulty || ("EASY" as Difficulty),
    labels: initialData?.labels.map((l) => l.id) || ([] as string[]),
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
    const colors = [
      "#ef4444",
      "#f97316",
      "#eab308",
      "#22c55e",
      "#3b82f6",
      "#a855f7",
      "#ec4899",
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const result = await createLabel(newLabelName, randomColor);
    if (result.success && result.data) {
      setAvailableLabels([...availableLabels, result.data]);
      setFormData((prev) => ({
        ...prev,
        labels: [...prev.labels, result.data!.id],
      }));
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
    setFormData((prev) => {
      const labels = prev.labels.includes(labelId)
        ? prev.labels.filter((id) => id !== labelId)
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
              const slug = title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)/g, "");
              setFormData((prev) => ({
                ...prev,
                title,
                slug: isEditing ? prev.slug : slug,
              }));
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
        <div className="flex items-center justify-between">
          <Label>Description</Label>
          <div className="flex items-center gap-2 bg-muted p-1 rounded-md">
            <button
              type="button"
              onClick={() => setActiveTab("en")}
              className={`px-3 py-1 text-xs font-medium rounded-sm transition-all ${activeTab === "en" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("es")}
              className={`px-3 py-1 text-xs font-medium rounded-sm transition-all ${activeTab === "es" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Spanish
            </button>
          </div>
        </div>

        <div className="relative">
          {activeTab === "es" && (
            <div className="absolute top-2 right-2 z-10">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!formData.description.en) {
                    toast.error("Please enter English description first");
                    return;
                  }
                  setIsTranslating(true);
                  const result = await translateContent(
                    formData.description.en,
                    "Spanish"
                  );
                  setIsTranslating(false);
                  if (result.success && result.text) {
                    setFormData((prev) => ({
                      ...prev,
                      description: { ...prev.description, es: result.text },
                    }));
                    toast.success("Translated successfully");
                  } else {
                    toast.error(result.error || "Translation failed");
                  }
                }}
                disabled={isTranslating || !formData.description.en}
                className="h-8 gap-2 bg-background/80 backdrop-blur-sm"
              >
                {isTranslating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3 text-indigo-500" />
                )}
                Translate from English
              </Button>
            </div>
          )}

          <RichTextEditor
            value={
              activeTab === "en"
                ? formData.description.en
                : formData.description.es
            }
            onChange={(value) =>
              setFormData((prev) => ({
                ...prev,
                description: {
                  ...prev.description,
                  [activeTab]: value,
                },
              }))
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {activeTab === "en"
            ? "Original English version."
            : "Spanish translation. You can auto-generate this from the English version."}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="difficulty">Difficulty</Label>
          <Select
            value={formData.difficulty}
            onValueChange={(value) =>
              setFormData({ ...formData, difficulty: value as Difficulty })
            }
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
            {formData.labels.map((labelId) => {
              const label = availableLabels.find((l) => l.id === labelId);
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
                  .filter((l) => !formData.labels.includes(l.id))
                  .map((label) => (
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
              <Button
                type="button"
                size="icon"
                onClick={handleCreateLabel}
                disabled={!newLabelName}
              >
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
            onChange={(value) =>
              setFormData({ ...formData, starterCode: value || "" })
            }
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
            onChange={(value) =>
              setFormData({ ...formData, solutionCode: value || "" })
            }
            options={{ minimap: { enabled: false } }}
          />
        </div>
      </div>

      <div className="flex justify-end gap-4">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading
            ? "Saving..."
            : isEditing
              ? "Update Challenge"
              : "Create Challenge"}
        </Button>
      </div>
    </form>
  );
}
