import React, { useEffect, useState } from "react";
import { subscriptionsApi, keysApi, agentsApi, notificationsApi } from "../lib/api";

const CATEGORIES = ["trading", "analysis", "data", "automation", "nlp", "vision", "other"];

interface Props {
  user: { id: string; name: string };
  onNavigate: (page: any) => void;
}

export default function DashboardPage({ user, onNavigate }: Props) {
  const [subs, setSubs] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [myAgents, setMyAgents] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"agents" | "subs" | "keys" | "webhooks">("agents");
  const [usageSlug, setUsageSlug] = useState<string | null>(null);
  const [usage, setUsage] = useState<any>(null);

  // Webhooks
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [newWhUrl, setNewWhUrl] = useState("");
  const [newWhEvents, setNewWhEvents] = useState<string[]>(["subscription.created", "review.created", "health.changed"]);
  const [createdWhSecret, setCreatedWhSecret] = useState<string | null>(null);

  // Edit state
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    agentsApi.mine().then((d) => setMyAgents(d.agents)).catch(() => {});
    subscriptionsApi.list().then((d) => setSubs(d.subscriptions)).catch(() => {});
    keysApi.list().then((d) => setKeys(d.keys)).catch(() => {});
    notificationsApi.listWebhooks().then((d) => setWebhooks(d.webhooks)).catch(() => {});
  }, []);

  async function createKey() {
    if (!newKeyName) return;
    try {
      const result = await keysApi.create(newKeyName);
      setCreatedKey(result.key);
      setNewKeyName("");
      keysApi.list().then((d) => setKeys(d.keys));
    } catch {}
  }

  async function revokeKey(id: string) {
    await keysApi.revoke(id);
    setKeys(keys.filter((k) => k.id !== id));
  }

  async function cancelSub(id: string) {
    await subscriptionsApi.cancel(id);
    setSubs(subs.map((s) => (s.id === id ? { ...s, status: "cancelled" } : s)));
  }

  async function toggleAgentStatus(slug: string, currentStatus: string) {
    const newStatus = currentStatus === "active" ? "suspended" : "active";
    await agentsApi.setStatus(slug, newStatus);
    setMyAgents(myAgents.map((a) => (a.slug === slug ? { ...a, status: newStatus } : a)));
  }

  async function deleteAgent(slug: string) {
    await agentsApi.remove(slug);
    setMyAgents(myAgents.filter((a) => a.slug !== slug));
    if (usageSlug === slug) {
      setUsageSlug(null);
      setUsage(null);
    }
    if (editSlug === slug) {
      setEditSlug(null);
    }
  }

  async function loadUsage(slug: string) {
    if (usageSlug === slug) {
      setUsageSlug(null);
      setUsage(null);
      return;
    }
    setUsageSlug(slug);
    setUsage(null);
    try {
      const data = await agentsApi.usage(slug);
      setUsage(data);
    } catch {
      setUsage({ error: true });
    }
  }

  function startEdit(agent: any) {
    if (editSlug === agent.slug) {
      setEditSlug(null);
      return;
    }
    setEditSlug(agent.slug);
    setEditError("");
    setEditForm({
      name: agent.name || "",
      description: agent.description || "",
      longDescription: agent.longDescription || "",
      category: agent.category || "other",
      tags: Array.isArray(agent.tags) ? agent.tags.join(", ") : "",
      endpointUrl: agent.endpointUrl || "",
      docsUrl: agent.docsUrl || "",
      pricing: agent.pricing || "free",
      pricePerCall: String(agent.pricePerCall || 0),
      monthlyPrice: String(agent.monthlyPrice || 0),
      rateLimit: String(agent.rateLimit || 100),
    });
  }

  async function saveEdit(slug: string) {
    setEditError("");
    setEditSaving(true);
    try {
      const payload: Record<string, any> = {};
      if (editForm.name) payload.name = editForm.name;
      if (editForm.description) payload.description = editForm.description;
      if (editForm.longDescription) payload.longDescription = editForm.longDescription;
      if (editForm.category) payload.category = editForm.category;
      if (editForm.tags) payload.tags = editForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (editForm.endpointUrl) payload.endpointUrl = editForm.endpointUrl;
      if (editForm.docsUrl) payload.docsUrl = editForm.docsUrl;
      if (editForm.pricing) payload.pricing = editForm.pricing;
      payload.pricePerCall = parseFloat(editForm.pricePerCall) || 0;
      payload.monthlyPrice = parseFloat(editForm.monthlyPrice) || 0;
      if (editForm.rateLimit) payload.rateLimit = parseInt(editForm.rateLimit) || 100;

      await agentsApi.update(slug, payload);

      // Update local state
      setMyAgents(myAgents.map((a) =>
        a.slug === slug
          ? {
              ...a,
              name: payload.name || a.name,
              description: payload.description || a.description,
              category: payload.category || a.category,
              tags: payload.tags || a.tags,
              pricing: payload.pricing || a.pricing,
              pricePerCall: payload.pricePerCall,
              monthlyPrice: payload.monthlyPrice,
              rateLimit: payload.rateLimit || a.rateLimit,
            }
          : a
      ));
      setEditSlug(null);
    } catch (err: any) {
      setEditError(err.message);
    }
    setEditSaving(false);
  }

  function healthBadge(status: string) {
    if (status === "healthy") return <span className="inline-block w-2 h-2 rounded-full bg-green-400 mr-1.5" title="Healthy" />;
    if (status === "unhealthy") return <span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1.5" title="Unhealthy" />;
    return <span className="inline-block w-2 h-2 rounded-full bg-gray-600 mr-1.5" title="Unknown" />;
  }

  const tabClass = (t: string) =>
    `pb-3 text-sm font-medium transition ${
      tab === t
        ? "text-indigo-400 border-b-2 border-indigo-400"
        : "text-gray-500 hover:text-white"
    }`;

  const inputClass = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500";

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Dashboard</h1>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-gray-800">
        <button onClick={() => setTab("agents")} className={tabClass("agents")}>
          My Agents ({myAgents.length})
        </button>
        <button onClick={() => setTab("subs")} className={tabClass("subs")}>
          Subscriptions ({subs.length})
        </button>
        <button onClick={() => setTab("keys")} className={tabClass("keys")}>
          API Keys ({keys.length})
        </button>
        <button onClick={() => setTab("webhooks")} className={tabClass("webhooks")}>
          Webhooks ({webhooks.length})
        </button>
      </div>

      {/* My Agents */}
      {tab === "agents" && (
        <div className="space-y-3">
          {myAgents.length === 0 && (
            <p className="text-gray-500">
              No agents published yet.{" "}
              <button
                onClick={() => onNavigate({ name: "publish" })}
                className="text-indigo-400 hover:underline"
              >
                Publish your first agent
              </button>
            </p>
          )}
          {myAgents.map((agent) => (
            <div key={agent.id}>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center">
                    {healthBadge(agent.healthStatus || "unknown")}
                    <button
                      onClick={() => onNavigate({ name: "agent", slug: agent.slug })}
                      className="text-white font-medium hover:text-indigo-400 transition"
                    >
                      {agent.name}
                    </button>
                    <span
                      className={`ml-3 text-xs px-2 py-0.5 rounded-full ${
                        agent.status === "active"
                          ? "bg-green-900/30 text-green-400"
                          : agent.status === "suspended"
                          ? "bg-yellow-900/30 text-yellow-400"
                          : "bg-gray-800 text-gray-500"
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(agent)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                    >
                      {editSlug === agent.slug ? "Cancel Edit" : "Edit"}
                    </button>
                    <button
                      onClick={() => loadUsage(agent.slug)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                    >
                      {usageSlug === agent.slug ? "Hide Stats" : "Stats"}
                    </button>
                    <button
                      onClick={() => toggleAgentStatus(agent.slug, agent.status)}
                      className={`text-xs transition ${
                        agent.status === "active"
                          ? "text-yellow-400 hover:text-yellow-300"
                          : "text-green-400 hover:text-green-300"
                      }`}
                    >
                      {agent.status === "active" ? "Suspend" : "Activate"}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${agent.name}"? This will cancel all subscriptions.`)) {
                          deleteAgent(agent.slug);
                        }
                      }}
                      className="text-xs text-red-400 hover:text-red-300 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mb-2">{agent.description}</p>
                <div className="flex gap-4 text-xs text-gray-600">
                  <span>{agent.subscriberCount} subscribers</span>
                  <span>{agent.totalCalls} total calls</span>
                  <span>{agent.category}</span>
                  {agent.healthCheckedAt && (
                    <span>
                      Checked {new Date(agent.healthCheckedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Edit Form */}
              {editSlug === agent.slug && (
                <div className="bg-gray-950 border border-gray-800 border-t-0 rounded-b-lg p-4">
                  {editError && (
                    <div className="text-sm text-red-400 mb-3">{editError}</div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Name</label>
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Category</label>
                      <select
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        className={inputClass}
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat.charAt(0).toUpperCase() + cat.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">Description</label>
                    <input
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">Long Description</label>
                    <textarea
                      value={editForm.longDescription}
                      onChange={(e) => setEditForm({ ...editForm, longDescription: e.target.value })}
                      rows={3}
                      className={inputClass}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Endpoint URL</label>
                      <input
                        value={editForm.endpointUrl}
                        onChange={(e) => setEditForm({ ...editForm, endpointUrl: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Docs URL</label>
                      <input
                        value={editForm.docsUrl}
                        onChange={(e) => setEditForm({ ...editForm, docsUrl: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">Tags (comma-separated)</label>
                    <input
                      value={editForm.tags}
                      onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                      className={inputClass}
                      placeholder="nlp, sentiment, twitter"
                    />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Pricing</label>
                      <select
                        value={editForm.pricing}
                        onChange={(e) => setEditForm({ ...editForm, pricing: e.target.value })}
                        className={inputClass}
                      >
                        <option value="free">Free</option>
                        <option value="usage">Per Call</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                    {editForm.pricing === "usage" && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">$/call</label>
                        <input
                          type="number"
                          step="0.001"
                          value={editForm.pricePerCall}
                          onChange={(e) => setEditForm({ ...editForm, pricePerCall: e.target.value })}
                          className={inputClass}
                        />
                      </div>
                    )}
                    {editForm.pricing === "monthly" && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">$/month</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.monthlyPrice}
                          onChange={(e) => setEditForm({ ...editForm, monthlyPrice: e.target.value })}
                          className={inputClass}
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Rate Limit/min</label>
                      <input
                        type="number"
                        value={editForm.rateLimit}
                        onChange={(e) => setEditForm({ ...editForm, rateLimit: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(agent.slug)}
                      disabled={editSaving}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-sm transition disabled:opacity-50"
                    >
                      {editSaving ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      onClick={() => setEditSlug(null)}
                      className="text-gray-400 hover:text-white px-4 py-1.5 rounded-lg text-sm transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Usage Stats Panel */}
              {usageSlug === agent.slug && usage && !usage.error && editSlug !== agent.slug && (
                <div className="bg-gray-950 border border-gray-800 border-t-0 rounded-b-lg p-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{usage.totalCalls}</p>
                      <p className="text-xs text-gray-500">Total Calls</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{usage.calls24h}</p>
                      <p className="text-xs text-gray-500">Last 24h</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{usage.avgLatencyMs}ms</p>
                      <p className="text-xs text-gray-500">Avg Latency</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{usage.errorRate}%</p>
                      <p className="text-xs text-gray-500">Error Rate</p>
                    </div>
                  </div>

                  {usage.estimatedRevenue > 0 && (
                    <div className="text-center mb-4 py-2 bg-green-900/10 rounded-lg">
                      <p className="text-lg font-bold text-green-400">${usage.estimatedRevenue.toFixed(2)}</p>
                      <p className="text-xs text-gray-500">Estimated Revenue</p>
                    </div>
                  )}

                  {usage.daily.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Last 7 days</p>
                      <div className="flex items-end gap-1 h-16">
                        {usage.daily.map((d: any) => {
                          const max = Math.max(...usage.daily.map((x: any) => x.count), 1);
                          const height = Math.max((d.count / max) * 100, 4);
                          return (
                            <div
                              key={d.date}
                              className="flex-1 bg-indigo-600 rounded-t"
                              style={{ height: `${height}%` }}
                              title={`${d.date}: ${d.count} calls, ${Math.round(d.avgLatency)}ms avg, ${d.errors} errors`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex gap-1 mt-1">
                        {usage.daily.map((d: any) => (
                          <span key={d.date} className="flex-1 text-center text-[10px] text-gray-600">
                            {d.date.slice(5)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Subscriptions */}
      {tab === "subs" && (
        <div className="space-y-3">
          {subs.length === 0 && (
            <p className="text-gray-500">
              No subscriptions yet.{" "}
              <button
                onClick={() => onNavigate({ name: "home" })}
                className="text-indigo-400 hover:underline"
              >
                Explore agents
              </button>
            </p>
          )}
          {subs.map((sub) => (
            <div
              key={sub.id}
              className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between"
            >
              <div>
                <button
                  onClick={() => onNavigate({ name: "agent", slug: sub.agentSlug })}
                  className="text-white font-medium hover:text-indigo-400 transition"
                >
                  {sub.agentName}
                </button>
                <p className="text-sm text-gray-500">
                  {sub.plan} · {sub.status}
                </p>
              </div>
              {sub.status === "active" && (
                <button
                  onClick={() => cancelSub(sub.id)}
                  className="text-sm text-red-400 hover:text-red-300 transition"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* API Keys */}
      {tab === "keys" && (
        <div>
          {/* Create Key */}
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. production)"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={createKey}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm transition"
            >
              Create Key
            </button>
          </div>

          {/* Show newly created key */}
          {createdKey && (
            <div className="bg-green-900/20 border border-green-700 rounded-lg p-4 mb-6">
              <p className="text-sm text-green-400 mb-2">
                Key created! Copy it now — you won't see it again.
              </p>
              <code className="text-sm text-green-300 bg-gray-950 px-3 py-2 rounded block break-all">
                {createdKey}
              </code>
            </div>
          )}

          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <span className="text-white font-medium">{key.name}</span>
                  <span className="text-sm text-gray-500 ml-3">
                    {key.prefix}...
                  </span>
                  {key.lastUsedAt && (
                    <span className="text-xs text-gray-600 ml-3">
                      Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => revokeKey(key.id)}
                  className="text-sm text-red-400 hover:text-red-300 transition"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Webhooks */}
      {tab === "webhooks" && (
        <div>
          <div className="mb-6 space-y-3">
            <div className="flex gap-2">
              <input
                type="url"
                value={newWhUrl}
                onChange={(e) => setNewWhUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={async () => {
                  if (!newWhUrl) return;
                  try {
                    const res = await notificationsApi.createWebhook({ url: newWhUrl, events: newWhEvents });
                    setCreatedWhSecret(res.secret);
                    setNewWhUrl("");
                    notificationsApi.listWebhooks().then((d) => setWebhooks(d.webhooks));
                  } catch {}
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm transition"
              >
                Add Webhook
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {["subscription.created", "review.created", "health.changed"].map((evt) => (
                <button
                  key={evt}
                  onClick={() =>
                    setNewWhEvents((prev) =>
                      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]
                    )
                  }
                  className={`text-xs px-3 py-1 rounded-full transition ${
                    newWhEvents.includes(evt)
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-800 text-gray-400"
                  }`}
                >
                  {evt}
                </button>
              ))}
            </div>
          </div>

          {createdWhSecret && (
            <div className="bg-green-900/20 border border-green-700 rounded-lg p-4 mb-6">
              <p className="text-sm text-green-400 mb-2">
                Webhook created! Save this signing secret — you won't see it again.
              </p>
              <code className="text-sm text-green-300 bg-gray-950 px-3 py-2 rounded block break-all">
                {createdWhSecret}
              </code>
            </div>
          )}

          <div className="space-y-3">
            {webhooks.length === 0 && (
              <p className="text-gray-500">No webhooks configured. Add one to receive real-time notifications.</p>
            )}
            {webhooks.map((wh) => (
              <div
                key={wh.id}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <span className="text-white text-sm font-mono">{wh.url}</span>
                  <div className="flex gap-1 mt-1">
                    {(wh.events || []).map((e: string) => (
                      <span key={e} className="text-[10px] bg-gray-800 text-gray-500 px-2 py-0.5 rounded">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    await notificationsApi.deleteWebhook(wh.id);
                    setWebhooks(webhooks.filter((w) => w.id !== wh.id));
                  }}
                  className="text-sm text-red-400 hover:text-red-300 transition"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
