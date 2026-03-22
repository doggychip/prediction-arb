import React, { useState } from "react";
import { agentsApi } from "../lib/api";

const CATEGORIES = ["trading", "analysis", "data", "automation", "nlp", "vision", "other"];

interface Props {
  onNavigate: (page: any) => void;
}

export default function PublishPage({ onNavigate }: Props) {
  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    longDescription: "",
    category: "other",
    tags: "",
    endpointUrl: "",
    docsUrl: "",
    pricing: "free",
    pricePerCall: "0",
    monthlyPrice: "0",
    rateLimit: "100",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField(key: string, value: string) {
    setForm({ ...form, [key]: value });
    if (key === "name" && !form.slug) {
      setForm({
        ...form,
        name: value,
        slug: value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = await agentsApi.create({
        name: form.name,
        slug: form.slug,
        description: form.description,
        longDescription: form.longDescription || undefined,
        category: form.category,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()) : undefined,
        endpointUrl: form.endpointUrl,
        docsUrl: form.docsUrl || undefined,
        pricing: form.pricing,
        pricePerCall: parseFloat(form.pricePerCall) || 0,
        monthlyPrice: parseFloat(form.monthlyPrice) || 0,
        rateLimit: parseInt(form.rateLimit) || 100,
      });
      onNavigate({ name: "agent", slug: result.slug });
    } catch (err: any) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-8">Publish an Agent</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-1">Name</label>
          <input
            required
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            placeholder="My Awesome Agent"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Slug</label>
          <input
            required
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            placeholder="my-awesome-agent"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Short Description</label>
          <input
            required
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            placeholder="One-line description of what your agent does"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Long Description</label>
          <textarea
            value={form.longDescription}
            onChange={(e) => setForm({ ...form, longDescription: e.target.value })}
            rows={4}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            placeholder="Detailed description..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Tags (comma-separated)</label>
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
              placeholder="nlp, sentiment, twitter"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Endpoint URL</label>
          <input
            required
            type="url"
            value={form.endpointUrl}
            onChange={(e) => setForm({ ...form, endpointUrl: e.target.value })}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            placeholder="https://my-agent.example.com/api/run"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Docs URL (optional)</label>
          <input
            type="url"
            value={form.docsUrl}
            onChange={(e) => setForm({ ...form, docsUrl: e.target.value })}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            placeholder="https://docs.example.com"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Pricing</label>
            <select
              value={form.pricing}
              onChange={(e) => setForm({ ...form, pricing: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="free">Free</option>
              <option value="usage">Per Call</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {form.pricing === "usage" && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">$/call</label>
              <input
                type="number"
                step="0.001"
                value={form.pricePerCall}
                onChange={(e) => setForm({ ...form, pricePerCall: e.target.value })}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}
          {form.pricing === "monthly" && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">$/month</label>
              <input
                type="number"
                step="0.01"
                value={form.monthlyPrice}
                onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Rate Limit/min</label>
            <input
              type="number"
              value={form.rateLimit}
              onChange={(e) => setForm({ ...form, rateLimit: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-medium transition disabled:opacity-50"
        >
          {submitting ? "Publishing..." : "Publish Agent"}
        </button>
      </form>
    </div>
  );
}
