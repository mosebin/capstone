import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  clearCurrentProjectData,
  getProjectContext,
  loadGeneratedIdeas,
  loadProjectContext,
  saveProjectContext,
  seedProjectDataForRoute,
} from '../lib/gpt';
import { getTeamId } from '../lib/eventLogger';
import {
  deleteProjectDocument,
  getCachedCanvasWorkspace,
  getCachedGeneratedIdeas,
  listProjects,
  updateProjectDocument,
} from '../lib/firebase';

const CATEGORIES = ['All', 'Service', 'UX/UI & Product', 'Brand & Identity', 'Game', 'Space'];
const LOCAL_PROJECT_CARD_ID = 'local-current-project';
const FALLBACK_PROJECT_IMAGE = 'https://images.unsplash.com/photo-1558655146-d09347e92766?w=600&q=80';
const SENIOR_DIARY_THUMBNAIL_URL = 'https://media.istockphoto.com/id/652420372/ko/%EC%82%AC%EC%A7%84/%EC%B1%85%EC%97%90-%EB%A9%94%EB%AA%A8%EB%A5%BC-%EC%9E%91%EC%84%B1-%ED%95%98%EB%8A%94-%EB%85%B8%EC%9D%B8.jpg?s=612x612&w=0&k=20&c=gQySpnS1wy0IQr3gEJoyaenUljHTAkgddAy8n7ACmxs=';

const resolveProjectId = (project) => project?.projectId || (project?.id !== LOCAL_PROJECT_CARD_ID ? project?.id : null);
const normalizeProjectStatus = status => (['done', 'complete', 'completed'].includes(String(status || '').toLowerCase()) ? 'done' : 'active');
const isSeniorDiaryProject = (project = {}) => {
  const text = [
    project.title,
    project.idea,
    project.input,
    project.projectTitle,
    project.projectInput,
  ].filter(Boolean).join(' ');
  return /노인|시니어|고령/.test(text) && /다이어리|일기|기록/.test(text);
};
const resolveProjectImage = project => (
  isSeniorDiaryProject(project) ? SENIOR_DIARY_THUMBNAIL_URL : project.img || project.thumbnail || FALLBACK_PROJECT_IMAGE
);
const padTime = value => String(value).padStart(2, '0');
const toProjectDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const formatProjectTimestamp = (value) => {
  const date = toProjectDate(value) || new Date();
  return `${date.getFullYear()}.${padTime(date.getMonth() + 1)}.${padTime(date.getDate())} ${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`;
};

/* ── Project Card with Figma hover effect ─────────────────────────────────── */
function ProjectCard({ project, isLoading = false, disabled = false, onClick, onDelete, onRename }) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const interactive = !isLoading && !disabled;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenu = () => setMenuOpen(false);
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [menuOpen]);

  return (
    <div
      aria-busy={isLoading}
      onClick={() => { if (interactive) onClick(); }}
      onMouseEnter={() => { if (interactive) setHover(true); }}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 12,
        overflow: 'hidden',
        background: '#1a1a1a',
        cursor: isLoading ? 'wait' : interactive ? 'pointer' : 'default',
        position: 'relative',
        height: 300,
        transition: 'box-shadow .2s',
        boxShadow: isLoading ? '0 0 0 1.5px #CBFF00' : hover ? '0 0 0 1.5px #CBFF00' : '0 0 0 1px #2a2a2a',
      }}
    >
      {/* Full-cover image with dark overlay */}
      <img
        src={project.img}
        alt={project.title}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%', objectFit: 'cover',
          transition: 'transform .35s ease',
          transform: hover ? 'scale(1.04)' : 'scale(1)',
        }}
      />
      {/* dark overlay — fades out on hover */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        transition: 'opacity .3s',
        opacity: hover ? 0.2 : 0.75,
      }} />

      {/* Category chip — top left */}
      <div style={{
        position: 'absolute', top: 12, left: 16,
        fontSize: 12, color: '#b0b0b0',
        transition: 'opacity .3s', opacity: hover ? 0 : 1,
      }}>{project.category}</div>

      {/* three-dot menu */}
      <button
        type="button"
        aria-label={`${project.title} 메뉴`}
        aria-expanded={menuOpen}
        disabled={!interactive}
        onPointerDown={event => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (!interactive) return;
          setMenuOpen(open => !open);
        }}
        style={{
          position: 'absolute', top: 8, right: 10,
          width: 32, height: 32, borderRadius: 8,
          color: menuOpen ? '#fff' : '#aaa', fontSize: 20,
          background: menuOpen ? 'rgba(20,20,20,.9)' : 'rgba(20,20,20,.35)',
          border: '1px solid rgba(255,255,255,.08)', zIndex: 6,
          cursor: interactive ? 'pointer' : 'default', lineHeight: 1,
          opacity: interactive ? 1 : .48,
        }}
      >⋮</button>

      {menuOpen && (
        <div
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          style={{
            position: 'absolute', top: 44, right: 10, zIndex: 6,
            width: 124, padding: 6, borderRadius: 9,
            background: '#202020', border: '1px solid #3a3a3a',
            boxShadow: '0 10px 28px rgba(0,0,0,.45)',
          }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(false);
              onRename();
            }}
            style={{
              width: '100%', padding: '9px 10px', borderRadius: 6,
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'transparent', border: 'none',
              color: '#e8e8e8', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span aria-hidden="true">✎</span>
            수정
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(false);
              onDelete();
            }}
            style={{
              width: '100%', padding: '9px 10px', borderRadius: 6,
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'transparent', border: 'none',
              color: '#ff7474', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span aria-hidden="true">✕</span>
            삭제
          </button>
        </div>
      )}

      {/* White slide-up bottom panel (Figma hover variant) */}
      <div style={{
        position: 'absolute', left: 0, right: 0,
        bottom: hover ? 0 : -72,
        height: 72,
        background: '#fff',
        borderRadius: '0 0 12px 12px',
        padding: '12px 16px',
        transition: 'bottom .28s ease',
        zIndex: 3,
      }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#111', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {project.title}
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>{project.date}</div>
      </div>

      {/* Default text (visible when NOT hovered) */}
      <div style={{
        position: 'absolute', bottom: 16, left: 16,
        transition: 'opacity .2s',
        opacity: hover ? 0 : 1,
        zIndex: 2,
      }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#fff', marginBottom: 4 }}>{project.title}</div>
        <div style={{ fontSize: 12, color: '#b0b0b0' }}>{project.date}</div>
      </div>

      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 8,
            background: 'rgba(0,0,0,0.72)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#CBFF00',
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 0,
          }}
        >
          프로젝트 불러오는 중...
        </div>
      )}
    </div>
  );
}

function RenameProjectModal({ project, saving, onCancel, onSave }) {
  const [title, setTitle] = useState(project?.title || '');
  const trimmedTitle = title.trim();
  const disabled = saving || !trimmedTitle;

  const submit = (event) => {
    event.preventDefault();
    if (!disabled) onSave(trimmedTitle);
  };

  return (
    <div
      onPointerDown={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, background: 'rgba(0,0,0,.68)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <form
        onSubmit={submit}
        onPointerDown={event => event.stopPropagation()}
        style={{
          width: 'min(430px, 100%)',
          background: '#1d1d1d',
          border: '1px solid #343434',
          borderRadius: 14,
          padding: 24,
          color: '#fff',
          boxShadow: '0 24px 80px rgba(0,0,0,.55)',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, letterSpacing: -0.3 }}>
          프로젝트 이름 수정
        </h3>
        <p style={{ margin: '0 0 18px', color: '#888', fontSize: 14, lineHeight: 1.55 }}>
          프로젝트 관리창에 표시될 이름을 입력하세요.
        </p>
        <input
          autoFocus
          value={title}
          onChange={event => setTitle(event.target.value)}
          maxLength={60}
          placeholder="프로젝트 이름"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '14px 15px',
            borderRadius: 10,
            border: `1.5px solid ${trimmedTitle ? '#CBFF00' : '#3a3a3a'}`,
            background: '#111',
            color: '#fff',
            outline: 'none',
            fontSize: 15,
            lineHeight: 1.4,
            marginBottom: 18,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              padding: '11px 16px',
              borderRadius: 999,
              border: '1px solid #3a3a3a',
              background: '#262626',
              color: '#bbb',
              fontSize: 14,
              fontWeight: 700,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="submit"
            disabled={disabled}
            style={{
              padding: '11px 18px',
              borderRadius: 999,
              border: 'none',
              background: disabled ? '#56631d' : '#CBFF00',
              color: '#111',
              fontSize: 14,
              fontWeight: 800,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── New Project Card ─────────────────────────────────────────────────────── */
function NewProjectCard({ disabled = false, onClick }) {
  const [hover, setHover] = useState(false);
  const interactive = !disabled;
  return (
    <div
      onClick={() => { if (interactive) onClick(); }}
      onMouseEnter={() => { if (interactive) setHover(true); }}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 12,
        height: 300,
        background: '#1a1a1a',
        border: `1px solid ${hover ? '#CBFF00' : '#666'}`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 8,
        cursor: interactive ? 'pointer' : 'default', transition: 'border .2s',
        opacity: interactive ? 1 : .58,
      }}
    >
      {/* plus icon */}
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path d="M20 12v16M12 20h16" stroke={hover ? '#CBFF00' : '#b0b0b0'} strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <div style={{ fontSize: 14, color: hover ? '#CBFF00' : '#b0b0b0', transition: 'color .2s' }}>New Project</div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function Projects() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [deletedProjectIds, setDeletedProjectIds] = useState([]);
  const [remoteProjects, setRemoteProjects] = useState([]);
  const [renamedProjectTitles, setRenamedProjectTitles] = useState({});
  const [editingProject, setEditingProject] = useState(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const doneSectionRef = useRef(null);
  const savedProject = getProjectContext();
  const savedWorkspace = getCachedCanvasWorkspace();
  const savedIdeas = getCachedGeneratedIdeas();
  const hasSavedProject = Boolean(savedProject.idea || savedWorkspace?.ideas?.length || savedIdeas.length);
  const savedAt = savedProject.updatedAt || savedWorkspace?.savedAt || savedWorkspace?.canvasWorkspaceUpdatedAt || savedProject.createdAt;
  const localProject = hasSavedProject ? {
    id: LOCAL_PROJECT_CARD_ID,
    projectId: savedProject.projectId,
    title: savedProject.title?.trim() || savedProject.idea?.trim() || '진행 중인 프로젝트',
    category: savedProject.domain || 'Service Design',
    date: `저장 ${formatProjectTimestamp(savedAt)}`,
    status: normalizeProjectStatus(savedProject.status),
    img: resolveProjectImage(savedProject),
    path: '/divergence',
  } : null;

  useEffect(() => {
    let cancelled = false;
    const teamId = getTeamId();
    listProjects(teamId)
      .then(items => {
        if (cancelled) return;
        setRemoteProjects(items.map(item => ({
          id: item.id,
          projectId: item.projectId || item.id,
          title: item.title || item.idea || 'Unnamed Project',
          category: item.domain || item.category || 'Service Design',
          date: `저장 ${formatProjectTimestamp(item.updatedAt || item.canvasWorkspaceUpdatedAt || item.ideasUpdatedAt || item.createdAt)}`,
          status: normalizeProjectStatus(item.status),
          img: resolveProjectImage(item),
          path: '/divergence',
          raw: item,
        })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const storedProjects = [
    ...(localProject ? [localProject] : []),
    ...remoteProjects.filter(project => !localProject?.projectId || String(project.projectId || project.id) !== String(localProject.projectId)),
  ]
    .filter(project => !deletedProjectIds.includes(String(project.id)))
    .map(project => ({
      ...project,
      title: renamedProjectTitles[String(project.id)] || project.title,
    }));
  const filtered = storedProjects.filter(p => activeFilter === 'All' || p.category === activeFilter);
  const active   = filtered.filter(p => p.status === 'active');
  const done     = filtered.filter(p => p.status === 'done');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('section') !== 'done') return undefined;
    const timer = window.setTimeout(() => {
      doneSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [done.length, location.search]);

  const grid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 20,
  };

  const navigateToNewProject = () => {
    navigate('/new-project');
    window.setTimeout(() => {
      if (window.location.pathname !== '/new-project') {
        window.location.assign('/new-project');
      }
    }, 300);
  };

  const startNewProject = () => {
    setOpeningProjectId(null);
    clearCurrentProjectData();
    navigateToNewProject();
  };

  const seedProjectForDivergence = (project, projectId) => {
    const source = project.raw || {};
    seedProjectDataForRoute({
      ...source,
      id: projectId,
      projectId,
      title: project.title || source.title || source.idea || '진행 중인 프로젝트',
      category: project.category || source.category || source.domain,
      status: project.status || source.status || 'active',
    }, source.ideas || []);
  };

  const navigateToDivergence = () => {
    navigate('/divergence');
    window.setTimeout(() => {
      if (window.location.pathname !== '/divergence') {
        window.location.assign('/divergence');
      }
    }, 300);
  };

  const openProject = (project) => {
    if (openingProjectId) return;
    setOpeningProjectId(String(project.id));
    const projectId = resolveProjectId(project);

    if (projectId && project.id !== LOCAL_PROJECT_CARD_ID) {
      try {
        seedProjectForDivergence(project, projectId);
      } catch (error) {
        console.warn('Failed to seed project before opening', error);
      }

      void Promise.all([
        loadProjectContext(projectId),
        loadGeneratedIdeas(projectId, { preferRemote: true }),
      ]).catch(error => {
        console.warn('Failed to refresh project after opening', error);
      });
    }

    navigateToDivergence();
  };

  const deleteProject = async (project) => {
    const projectId = String(project.id);
    const databaseProjectId = resolveProjectId(project);
    if (databaseProjectId) {
      await deleteProjectDocument(String(databaseProjectId));
      setRemoteProjects(prev => prev.filter(item => String(item.projectId || item.id) !== String(databaseProjectId)));
    }
    if (projectId === LOCAL_PROJECT_CARD_ID) {
      clearCurrentProjectData();
      setDeletedProjectIds(prev => prev.includes(projectId) ? prev : [...prev, projectId]);
      return;
    }
    setDeletedProjectIds(prev => prev.includes(projectId) ? prev : [...prev, projectId]);
  };

  const renameProject = async (nextTitle) => {
    if (!editingProject) return;
    const projectId = String(editingProject.id);
    const databaseProjectId = resolveProjectId(editingProject);
    setRenameSaving(true);
    try {
      if (projectId === LOCAL_PROJECT_CARD_ID) {
        const currentContext = getProjectContext();
        await saveProjectContext({
          ...currentContext,
          title: nextTitle,
          updatedAt: new Date().toISOString(),
        });
      } else if (databaseProjectId) {
        await updateProjectDocument(String(databaseProjectId), { title: nextTitle });
        setRemoteProjects(prev => prev.map(project => (
          String(project.projectId || project.id) === String(databaseProjectId) ? { ...project, title: nextTitle } : project
        )));
      }
      if (databaseProjectId && projectId === LOCAL_PROJECT_CARD_ID) {
        setRemoteProjects(prev => prev.map(project => (
          String(project.projectId || project.id) === String(databaseProjectId) ? { ...project, title: nextTitle } : project
        )));
      }
      setRenamedProjectTitles(prev => ({ ...prev, [projectId]: nextTitle }));
      setEditingProject(null);
    } finally {
      setRenameSaving(false);
    }
  };

  return (
    <div className="dot-bg" style={{ minHeight: 'calc(100vh - 100px)', width: '100%', padding: '40px 120px' }}>
      <h1 style={{ fontSize: 36, fontWeight: 700, marginBottom: 24, letterSpacing: -0.9 }}>My Projects</h1>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 40, flexWrap: 'wrap' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveFilter(cat)}
            style={{
              padding: '12px 20px', borderRadius: 999, fontSize: 14, fontWeight: 500,
              background: activeFilter === cat ? '#d4ff00' : '#2a2a2a',
              color: activeFilter === cat ? '#1a1a1a' : '#b0b0b0',
              border: 'none', cursor: 'pointer', transition: 'all .2s',
            }}
          >{cat}</button>
        ))}
      </div>

      {/* 진행 중인 프로젝트 */}
      <h2 style={{ fontSize: 28, fontWeight: 600, marginBottom: 20, letterSpacing: -0.9 }}>진행 중인 프로젝트</h2>
      <div style={{ ...grid, marginBottom: 48 }}>
        <NewProjectCard onClick={startNewProject} />
        {active.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            isLoading={openingProjectId === String(p.id)}
            disabled={Boolean(openingProjectId)}
            onClick={() => openProject(p)}
            onDelete={() => deleteProject(p)}
            onRename={() => setEditingProject(p)}
          />
        ))}
      </div>

      {/* 완료된 프로젝트 */}
      <h2 ref={doneSectionRef} style={{ fontSize: 28, fontWeight: 600, marginBottom: 20, letterSpacing: -0.9, scrollMarginTop: 118 }}>완료된 프로젝트</h2>
      <div style={grid}>
        {done.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            isLoading={openingProjectId === String(p.id)}
            disabled={Boolean(openingProjectId)}
            onClick={() => openProject(p)}
            onDelete={() => deleteProject(p)}
            onRename={() => setEditingProject(p)}
          />
        ))}
      </div>

      {editingProject && (
        <RenameProjectModal
          project={editingProject}
          saving={renameSaving}
          onCancel={() => { if (!renameSaving) setEditingProject(null); }}
          onSave={renameProject}
        />
      )}

      {openingProjectId && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', inset: 0, zIndex: 260,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,.58)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          <div
            style={{
              minWidth: 260,
              padding: '22px 26px',
              borderRadius: 12,
              background: '#1b1b1b',
              border: '1px solid rgba(203,255,0,.35)',
              boxShadow: '0 22px 80px rgba(0,0,0,.5)',
              color: '#fff',
              textAlign: 'center',
            }}
          >
            <div style={{ color: '#CBFF00', fontSize: 15, fontWeight: 800, marginBottom: 8 }}>
              프로젝트 불러오는 중...
            </div>
            <div style={{ color: '#aaa', fontSize: 13, lineHeight: 1.5 }}>
              발산 단계로 이동하고 있습니다.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
