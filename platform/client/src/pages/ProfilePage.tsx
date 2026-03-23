import React, { useEffect, useState } from "react";
import { auth, agentsApi } from "../lib/api";

interface Props {
  user: { id: string; name: string; email: string };
  onUserUpdate: (user: { id: string; name: string; email: string }) => void;
}

export default function ProfilePage({ user, onUserUpdate }: Props) {
  const [profile, setProfile] = useState<{
    name: string;
    email: string;
    bio: string;
    verified: boolean;
    createdAt: string;
    agentCount: number;
  } | null>(null);
  const [myAgents, setMyAgents] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    auth.me().then((p) => {
      setProfile({
        name: p.name,
        email: p.email,
        bio: p.bio || "",
        verified: p.verified ?? false,
        createdAt: p.createdAt || "",
        agentCount: p.agentCount,
      });
      setName(p.name);
      setBio(p.bio || "");
    }).catch(() => setError("Failed to load profile"));

    agentsApi.list().then((data) => {
      setMyAgents(data.agents.filter((a: any) => a.creatorId === user.id));
    }).catch(() => {});
  }, [user.id]);

  async function handleSave() {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await auth.updateProfile({ name, bio });
      setProfile((p) => p ? { ...p, name, bio } : p);
      onUserUpdate({ ...user, name });
      setEditing(false);
      setSuccess("Profile updated");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  if (!profile) {
    return <div className="text-gray-500">Loading profile...</div>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Developer Profile</h1>

      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 text-sm text-red-400 mb-6">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-900/20 border border-green-700 rounded-lg p-3 text-sm text-green-400 mb-6">
          {success}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-8">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-2xl font-bold text-white">
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                {profile.name}
                {profile.verified && (
                  <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full">
                    Verified
                  </span>
                )}
              </h2>
              <p className="text-sm text-gray-400">{profile.email}</p>
              {profile.createdAt && (
                <p className="text-xs text-gray-600 mt-1">
                  Joined {new Date(profile.createdAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-indigo-400 hover:text-indigo-300 transition"
            >
              Edit Profile
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                placeholder="Tell other developers about yourself..."
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setName(profile.name);
                  setBio(profile.bio);
                }}
                className="text-gray-400 hover:text-white px-4 py-2 text-sm transition"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            {profile.bio && (
              <p className="text-gray-300 text-sm">{profile.bio}</p>
            )}
            {!profile.bio && (
              <p className="text-gray-600 text-sm italic">No bio yet</p>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-white">{profile.agentCount}</p>
          <p className="text-sm text-gray-500">Published Agents</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-white">
            {profile.verified ? "Yes" : "No"}
          </p>
          <p className="text-sm text-gray-500">Verified Creator</p>
        </div>
      </div>

      {/* My Agents */}
      {myAgents.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">My Agents</h3>
          <div className="space-y-3">
            {myAgents.map((agent) => (
              <div
                key={agent.id}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <span className="text-white font-medium">{agent.name}</span>
                  <p className="text-sm text-gray-500">{agent.description}</p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    agent.status === "active"
                      ? "bg-green-900/30 text-green-400"
                      : "bg-gray-800 text-gray-500"
                  }`}
                >
                  {agent.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
