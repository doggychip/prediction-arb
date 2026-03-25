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
    emailVerified: boolean;
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

  // Password change
  const [showPwChange, setShowPwChange] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // Email verification
  const [verifying, setVerifying] = useState(false);
  const [verifyToken, setVerifyToken] = useState("");
  const [showVerifyInput, setShowVerifyInput] = useState(false);

  useEffect(() => {
    auth.me().then((p) => {
      setProfile({
        name: p.name,
        email: p.email,
        bio: p.bio || "",
        verified: p.verified ?? false,
        emailVerified: p.emailVerified ?? false,
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

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setPwSaving(true);
    try {
      await auth.changePassword({ currentPassword: currentPw, newPassword: newPw });
      setSuccess("Password changed successfully");
      setShowPwChange(false);
      setCurrentPw("");
      setNewPw("");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
    setPwSaving(false);
  }

  async function handleSendVerification() {
    setError("");
    setSuccess("");
    setVerifying(true);
    try {
      const res = await auth.sendVerification();
      if (res.token) {
        // Dev mode: got token directly
        setVerifyToken(res.token);
        setShowVerifyInput(true);
        setSuccess("Verification token generated (dev mode)");
      } else {
        setSuccess(res.message);
        setShowVerifyInput(true);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setVerifying(false);
  }

  async function handleConfirmVerification(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    try {
      await auth.confirmVerification(verifyToken);
      setProfile((p) => p ? { ...p, emailVerified: true } : p);
      setSuccess("Email verified!");
      setShowVerifyInput(false);
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!profile) {
    return <div className="text-gray-500">Loading profile...</div>;
  }

  const inputClass = "w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500";

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
              <p className="text-sm text-gray-400 flex items-center gap-2">
                {profile.email}
                {profile.emailVerified ? (
                  <span className="text-xs text-green-400">(verified)</span>
                ) : (
                  <button
                    onClick={handleSendVerification}
                    disabled={verifying}
                    className="text-xs text-yellow-400 hover:text-yellow-300 transition"
                  >
                    {verifying ? "Sending..." : "Verify email"}
                  </button>
                )}
              </p>
              {profile.createdAt && (
                <p className="text-xs text-gray-600 mt-1">
                  Joined {new Date(profile.createdAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-indigo-400 hover:text-indigo-300 transition"
              >
                Edit Profile
              </button>
            )}
            <button
              onClick={() => setShowPwChange(!showPwChange)}
              className="text-sm text-gray-400 hover:text-white transition"
            >
              {showPwChange ? "Cancel" : "Change Password"}
            </button>
          </div>
        </div>

        {/* Email verification input */}
        {showVerifyInput && !profile.emailVerified && (
          <form onSubmit={handleConfirmVerification} className="mb-4 flex gap-2">
            <input
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              placeholder="Paste verification token"
              className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm transition"
            >
              Confirm
            </button>
          </form>
        )}

        {/* Password change form */}
        {showPwChange && (
          <form onSubmit={handlePasswordChange} className="mb-6 space-y-3 border-b border-gray-800 pb-6">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Current Password</label>
              <input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                minLength={8}
                className={inputClass}
              />
              <p className="text-xs text-gray-600 mt-1">Minimum 8 characters</p>
            </div>
            <button
              type="submit"
              disabled={pwSaving}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50"
            >
              {pwSaving ? "Changing..." : "Update Password"}
            </button>
          </form>
        )}

        {editing ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                placeholder="Tell other developers about yourself..."
                className={`${inputClass} placeholder-gray-500 resize-none`}
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
      <div className="grid grid-cols-3 gap-4 mb-8">
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
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-white">
            {profile.emailVerified ? "Yes" : "No"}
          </p>
          <p className="text-sm text-gray-500">Email Verified</p>
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
