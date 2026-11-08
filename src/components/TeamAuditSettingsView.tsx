"use client";

import React, { useState } from "react";
import { WorkspaceState } from "@/lib/domain";
import { Role, ROLE_DESCRIPTIONS } from "@/lib/tenant";
import { formatNgn, parseNairaToKobo } from "@/lib/money";

interface TeamAuditSettingsViewProps {
  mode: "team" | "settings";
  state: WorkspaceState;
  activeRole: Role;
  canManageMembers: boolean;
  canManageSettings: boolean;
  canManageCategories: boolean;
  canViewAllAudit: boolean;
  onInviteMember: (payload: { name: string; email: string; role: Role }) => void;
  onToggleMemberStatus: (memberId: string) => void;
  onChangeMemberRole: (memberId: string, role: Role) => void;
  onUpdateWorkspaceProfile: (payload: {
    legalName: string;
    displayName: string;
    stateCity: string;
    taxId?: string;
    lowCashThresholdKobo: number;
  }) => void;
  onAddCategory: (payload: { name: string; type: "income" | "expense" | "both" }) => void;
  onToggleArchiveCategory: (categoryId: string) => void;
  onAddTrackingAccount: (payload: {
    name: string;
    kind: "bank_label" | "pos_label" | "cash_label";
    maskedRef?: string;
    openingBalanceKobo: number;
  }) => void;
  onRevokeOtherSessions: () => void;
}

export function TeamAuditSettingsView({
  mode,
  state,
  activeRole,
  canManageMembers,
  canManageSettings,
  canManageCategories,
  canViewAllAudit,
  onInviteMember,
  onToggleMemberStatus,
  onChangeMemberRole,
  onUpdateWorkspaceProfile,
  onAddCategory,
  onToggleArchiveCategory,
  onAddTrackingAccount,
  onRevokeOtherSessions,
}: TeamAuditSettingsViewProps) {
  // Team & Audit states
  const [auditFilterEntity, setAuditFilterEntity] = useState<string>("all");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("bookkeeper");
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Settings states
  const [legalName, setLegalName] = useState(state.workspace.legalName);
  const [displayName, setDisplayName] = useState(state.workspace.displayName);
  const [stateCity, setStateCity] = useState(state.workspace.stateCity);
  const [taxId, setTaxId] = useState(state.workspace.taxId ?? "");
  const [lowCashInput, setLowCashInput] = useState(
    (state.workspace.lowCashThresholdKobo / 100).toFixed(2),
  );
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string | null>(null);

  // New Category & Tracking Label
  const [newCatName, setNewCatName] = useState("");
  const [newCatType, setNewCatType] = useState<"income" | "expense" | "both">("expense");
  const [newAccName, setNewAccName] = useState("");
  const [newAccKind, setNewAccKind] = useState<"bank_label" | "pos_label" | "cash_label">(
    "bank_label",
  );
  const [newAccRef, setNewAccRef] = useState("");
  const [newAccOpening, setNewAccOpening] = useState("0");

  const filteredAudit = state.auditEvents.filter((ev) => {
    if (!canViewAllAudit && ev.actorRole !== activeRole && ev.entityType !== "import") {
      return false;
    }
    if (auditFilterEntity !== "all" && ev.entityType !== auditFilterEntity) return false;
    return true;
  });

  const handleInviteSubmit = () => {
    setInviteError(null);
    if (!inviteName.trim() || !inviteEmail.trim()) {
      setInviteError("Name and email address are required to send an invitation.");
      return;
    }
    onInviteMember({
      name: inviteName.trim(),
      email: inviteEmail.trim(),
      role: inviteRole,
    });
    setInviteName("");
    setInviteEmail("");
    setShowInviteModal(false);
  };

  const handleSaveWorkspaceSettings = () => {
    let thresholdKobo = state.workspace.lowCashThresholdKobo;
    try {
      thresholdKobo = parseNairaToKobo(lowCashInput);
    } catch {
      thresholdKobo = 50_000_000;
    }
    onUpdateWorkspaceProfile({
      legalName: legalName.trim() || state.workspace.legalName,
      displayName: displayName.trim() || state.workspace.displayName,
      stateCity: stateCity.trim() || state.workspace.stateCity,
      taxId: taxId.trim() || undefined,
      lowCashThresholdKobo: thresholdKobo,
    });
    setSettingsSavedMsg("Workspace profile and Money Brief threshold saved.");
  };

  if (mode === "team") {
    return (
      <div className="page-wrap">
        <div className="heading-row">
          <div>
            <p className="eyebrow">TEAM ACCESS, ROLES & APPEND-ONLY AUDIT TRAIL</p>
            <h1>Team & Audit History</h1>
            <p className="subheading">
              Workspace-scoped permissions. Every financial change, import, and membership update is logged in the tamper-evident audit feed.
            </p>
          </div>
          <div className="heading-actions">
            {canManageMembers && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setInviteError(null);
                  setShowInviteModal(true);
                }}
              >
                ＋ <span>Invite team member</span>
              </button>
            )}
          </div>
        </div>

        {/* Role Matrix Overview */}
        <section className="metrics" aria-label="Workspace role definitions">
          {(["owner", "admin", "bookkeeper", "accountant"] as const).map((r) => (
            <article className="metric" key={r}>
              <div>
                <span>ROLE SCOPE</span>
                <span className="tag income">{ROLE_DESCRIPTIONS[r].label}</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text)", margin: "10px 0 6px" }}>
                {ROLE_DESCRIPTIONS[r].summary}
              </p>
              <small>Restricted: {ROLE_DESCRIPTIONS[r].restricted[0]}</small>
            </article>
          ))}
        </section>

        {/* Team Members Table */}
        <section className="panel transactions" style={{ marginBottom: 18 }}>
          <div className="panel-head">
            <div>
              <h2>Workspace Members ({state.members.length})</h2>
              <p>
                Deactivating a member revokes workspace access immediately and records an audit event
              </p>
            </div>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email / Contact</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.members.map((m) => (
                  <tr key={m.id}>
                    <td className="description">{m.name}</td>
                    <td>
                      {m.email}
                      {m.phone && <span className="sub-meta">{m.phone}</span>}
                    </td>
                    <td>
                      {canManageMembers && m.role !== "owner" ? (
                        <select
                          className="period-select"
                          value={m.role}
                          onChange={(e) =>
                            onChangeMemberRole(m.id, e.target.value as Role)
                          }
                        >
                          <option value="admin">Admin</option>
                          <option value="bookkeeper">Bookkeeper</option>
                          <option value="accountant">External Accountant</option>
                        </select>
                      ) : (
                        <span className="tag income">{m.role.toUpperCase()}</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`tag ${
                          m.status === "active"
                            ? "income"
                            : m.status === "invited"
                              ? "amber"
                              : "coral"
                        }`}
                      >
                        {m.status.toUpperCase()}
                      </span>
                    </td>
                    <td>{m.lastActiveAt ?? `Invited ${m.invitedAt}`}</td>
                    <td>
                      {canManageMembers && m.role !== "owner" ? (
                        <button
                          type="button"
                          className="subtle-btn"
                          onClick={() => onToggleMemberStatus(m.id)}
                        >
                          {m.status === "active" ? "Deactivate" : "Activate / Approve"}
                        </button>
                      ) : (
                        <span className="sub-meta">Primary Owner</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Audit Events Feed */}
        <section className="panel transactions">
          <div className="panel-head">
            <div>
              <h2>Append-Only Audit History ({filteredAudit.length})</h2>
              <p>
                {canViewAllAudit
                  ? "Showing full workspace security and financial event log"
                  : "Showing your own and import-related events (Bookkeeper scope)"}
              </p>
            </div>
            <select
              className="period-select"
              value={auditFilterEntity}
              onChange={(e) => setAuditFilterEntity(e.target.value)}
            >
              <option value="all">All entity types</option>
              <option value="transaction">Transactions</option>
              <option value="invoice">Invoices & Receipts</option>
              <option value="bill">Supplier Bills</option>
              <option value="import">CSV Imports</option>
              <option value="member">Team & Roles</option>
              <option value="workspace">Workspace Settings</option>
            </select>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Timestamp (WAT)</th>
                  <th>Actor & Role</th>
                  <th>Action</th>
                  <th>Summary & Before/After State</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((ev) => (
                  <tr key={ev.id}>
                    <td>{ev.timestamp.slice(0, 16).replace("T", " ")}</td>
                    <td className="description">
                      {ev.actorName}{" "}
                      <span className="tag expense">{ev.actorRole.toUpperCase()}</span>
                    </td>
                    <td>
                      <code>{ev.action}</code>
                    </td>
                    <td>
                      <div>{ev.summary}</div>
                      {(ev.beforeSnapshot || ev.afterSnapshot) && (
                        <span className="sub-meta">
                          {ev.beforeSnapshot ? `Before: ${ev.beforeSnapshot} → ` : ""}
                          {ev.afterSnapshot ? `After: ${ev.afterSnapshot}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Invite Member Modal */}
        {showInviteModal && (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="inv-mem-title">
            <div className="modal-card">
              <div className="modal-header">
                <div>
                  <span className="brief-label">SCOPED WORKSPACE INVITATION</span>
                  <h2 id="inv-mem-title">Invite a team member or accountant</h2>
                </div>
                <button
                  type="button"
                  className="close-btn"
                  onClick={() => setShowInviteModal(false)}
                >
                  ✕
                </button>
              </div>
              <div className="modal-body">
                {inviteError && (
                  <div className="error-banner" role="alert">
                    {inviteError}
                  </div>
                )}

                <div className="form-grid">
                  <label className="form-field full-span">
                    <span>Full Name *</span>
                    <input
                      type="text"
                      placeholder="e.g. Funke Adeyemi"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                    />
                  </label>

                  <label className="form-field full-span">
                    <span>Email Address *</span>
                    <input
                      type="email"
                      placeholder="funke@company.ng"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </label>

                  <label className="form-field full-span">
                    <span>Assigned Workspace Role *</span>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Role)}
                    >
                      <option value="bookkeeper">Bookkeeper (Records, imports, invoices & bills)</option>
                      <option value="accountant">External Accountant (Read-only & exports)</option>
                      <option value="admin">Admin (Full operational & team access)</option>
                    </select>
                  </label>
                </div>

                <div className="field-block" style={{ marginTop: 12 }}>
                  <h4>What {ROLE_DESCRIPTIONS[inviteRole].label} can do:</h4>
                  <ul className="role-list">
                    {ROLE_DESCRIPTIONS[inviteRole].allowed.map((item) => (
                      <li key={item}>✓ {item}</li>
                    ))}
                  </ul>
                  <h4 style={{ marginTop: 8 }}>What this role cannot do:</h4>
                  <ul className="role-list">
                    {ROLE_DESCRIPTIONS[inviteRole].restricted.map((item) => (
                      <li key={item}>✕ {item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowInviteModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={handleInviteSubmit}
                >
                  Send invitation
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Settings Mode
  return (
    <div className="page-wrap">
      <div className="heading-row">
        <div>
          <p className="eyebrow">WORKSPACE SETTINGS, LABELS & SECURITY</p>
          <h1>Settings</h1>
          <p className="subheading">
            Configure your Nigerian business profile, non-custodial tracking labels, categories, and active sessions.
          </p>
        </div>
      </div>

      {settingsSavedMsg && (
        <div className="coverage" role="status">
          <span className="pulse" />
          <span>{settingsSavedMsg}</span>
          <button
            type="button"
            className="coverage-link-btn"
            onClick={() => setSettingsSavedMsg(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="lower-grid">
        {/* Business Profile & Defaults */}
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Business Workspace Profile</h2>
              <p>Base currency NGN (₦) · Timezone Africa/Lagos (WAT)</p>
            </div>
            <span className="tag income">{state.workspace.planName}</span>
          </div>

          <div className="form-grid">
            <label className="form-field">
              <span>Legal Business Name</span>
              <input
                type="text"
                disabled={!canManageSettings}
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Display Name</span>
              <input
                type="text"
                disabled={!canManageSettings}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span>State / City</span>
              <input
                type="text"
                disabled={!canManageSettings}
                value={stateCity}
                onChange={(e) => setStateCity(e.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Optional CAC / TIN Identifier</span>
              <input
                type="text"
                disabled={!canManageSettings}
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
              />
            </label>

            <label className="form-field full-span">
              <span>Low Recorded Cash Alert Threshold (NGN)</span>
              <input
                type="text"
                disabled={!canManageSettings}
                value={lowCashInput}
                onChange={(e) => setLowCashInput(e.target.value)}
              />
              <small>
                Triggers a deterministic Money Brief warning when total recorded cash falls below this figure.
              </small>
            </label>
          </div>

          {canManageSettings && (
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="primary"
                onClick={handleSaveWorkspaceSettings}
              >
                Save workspace profile
              </button>
            </div>
          )}
        </article>

        {/* Active Sessions & Security */}
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Active Sessions & Security</h2>
              <p>Manage verified devices signed into your account</p>
            </div>
            {state.sessions.length > 1 && (
              <button
                type="button"
                className="secondary-btn"
                onClick={onRevokeOtherSessions}
              >
                Sign out other sessions
              </button>
            )}
          </div>

          {state.sessions.map((s) => (
            <div className="attention-row" key={s.id}>
              <span className="attention-icon green">✓</span>
              <span>
                <b>
                  {s.device} {s.current && <span className="tag income">CURRENT</span>}
                </b>
                <small>
                  {s.location} · {s.lastActive}
                </small>
              </span>
            </div>
          ))}

          <div className="field-block" style={{ marginTop: 14 }}>
            <h4>Privacy & Notification Guardrails</h4>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              ✓ Sensitive NGN amounts are hidden in email subject lines and mobile lock-screen notifications by default.
              <br />✓ Data protection aligned with Nigeria Data Protection Act (NDPA) 2023 principles.
            </p>
          </div>
        </article>
      </div>

      {/* Non-Custodial Tracking Accounts & Categories */}
      <div className="lower-grid" style={{ marginTop: 16 }}>
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Tracking Labels (Non-Custodial)</h2>
              <p>A label for your records; not connected to a bank or wallet</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Label Name</th>
                <th>Type / Ref</th>
                <th>Opening Recorded Balance</th>
              </tr>
            </thead>
            <tbody>
              {state.trackingAccounts.map((acc) => (
                <tr key={acc.id}>
                  <td className="description">{acc.name}</td>
                  <td>{acc.maskedRef ?? acc.kind}</td>
                  <td>{formatNgn(acc.openingBalanceKobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {canManageCategories && (
            <div className="form-grid" style={{ marginTop: 14 }}>
              <label className="form-field">
                <span>New Tracking Label Name</span>
                <input
                  type="text"
                  placeholder="e.g. Zenith Bank ••9012"
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Label Type</span>
                <select
                  value={newAccKind}
                  onChange={(e) =>
                    setNewAccKind(
                      e.target.value as "bank_label" | "pos_label" | "cash_label",
                    )
                  }
                >
                  <option value="bank_label">Bank Account Label</option>
                  <option value="pos_label">POS Settlement Label</option>
                  <option value="cash_label">Cash Box Label</option>
                </select>
              </label>
              <label className="form-field">
                <span>Reference Note</span>
                <input
                  type="text"
                  placeholder="e.g. Corporate Current"
                  value={newAccRef}
                  onChange={(e) => setNewAccRef(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Opening Recorded Balance (NGN)</span>
                <input
                  type="text"
                  value={newAccOpening}
                  onChange={(e) => setNewAccOpening(e.target.value)}
                />
              </label>
              <div className="full-span">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    if (!newAccName.trim()) return;
                    let openKobo = 0;
                    try {
                      if (newAccOpening !== "0") openKobo = parseNairaToKobo(newAccOpening);
                    } catch {
                      openKobo = 0;
                    }
                    onAddTrackingAccount({
                      name: newAccName.trim(),
                      kind: newAccKind,
                      maskedRef: newAccRef.trim() || undefined,
                      openingBalanceKobo: openKobo,
                    });
                    setNewAccName("");
                    setNewAccRef("");
                    setNewAccOpening("0");
                  }}
                >
                  ＋ Add tracking label
                </button>
              </div>
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Income & Expense Categories</h2>
              <p>Categories referenced by records are archived rather than deleted</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Direction</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {state.categories.map((cat) => (
                <tr key={cat.id}>
                  <td className="description">{cat.name}</td>
                  <td>{cat.type.toUpperCase()}</td>
                  <td>
                    <span className={`tag ${cat.archived ? "coral" : "income"}`}>
                      {cat.archived ? "ARCHIVED" : "ACTIVE"}
                    </span>
                  </td>
                  <td>
                    {canManageCategories && (
                      <button
                        type="button"
                        className="subtle-btn"
                        onClick={() => onToggleArchiveCategory(cat.id)}
                      >
                        {cat.archived ? "Restore" : "Archive"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {canManageCategories && (
            <div className="form-grid" style={{ marginTop: 14 }}>
              <label className="form-field">
                <span>New Category Name</span>
                <input
                  type="text"
                  placeholder="e.g. Generator Fuel & Diesel"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Category Type</span>
                <select
                  value={newCatType}
                  onChange={(e) =>
                    setNewCatType(e.target.value as "income" | "expense" | "both")
                  }
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="both">Both</option>
                </select>
              </label>
              <div className="full-span">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    if (!newCatName.trim()) return;
                    onAddCategory({ name: newCatName.trim(), type: newCatType });
                    setNewCatName("");
                  }}
                >
                  ＋ Add category
                </button>
              </div>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

