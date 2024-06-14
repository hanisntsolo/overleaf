const _ = require('lodash')
const OError = require('@overleaf/o-error')
const crypto = require('crypto')
const { setTimeout } = require('timers/promises')
const pProps = require('p-props')
const logger = require('@overleaf/logger')
const { expressify } = require('@overleaf/promise-utils')
const { ObjectId } = require('mongodb')
const ProjectDeleter = require('./ProjectDeleter')
const ProjectDuplicator = require('./ProjectDuplicator')
const ProjectCreationHandler = require('./ProjectCreationHandler')
const EditorController = require('../Editor/EditorController')
const ProjectHelper = require('./ProjectHelper')
const metrics = require('@overleaf/metrics')
const { User } = require('../../models/User')
const SubscriptionLocator = require('../Subscription/SubscriptionLocator')
const LimitationsManager = require('../Subscription/LimitationsManager')
const Settings = require('@overleaf/settings')
const AuthorizationManager = require('../Authorization/AuthorizationManager')
const InactiveProjectManager = require('../InactiveData/InactiveProjectManager')
const ProjectUpdateHandler = require('./ProjectUpdateHandler')
const ProjectGetter = require('./ProjectGetter')
const PrivilegeLevels = require('../Authorization/PrivilegeLevels')
const SessionManager = require('../Authentication/SessionManager')
const Sources = require('../Authorization/Sources')
const TokenAccessHandler = require('../TokenAccess/TokenAccessHandler')
const CollaboratorsGetter = require('../Collaborators/CollaboratorsGetter')
const ProjectEntityHandler = require('./ProjectEntityHandler')
const TpdsProjectFlusher = require('../ThirdPartyDataStore/TpdsProjectFlusher')
const Features = require('../../infrastructure/Features')
const BrandVariationsHandler = require('../BrandVariations/BrandVariationsHandler')
const UserController = require('../User/UserController')
const AnalyticsManager = require('../Analytics/AnalyticsManager')
const SplitTestHandler = require('../SplitTests/SplitTestHandler')
const SplitTestSessionHandler = require('../SplitTests/SplitTestSessionHandler')
const FeaturesUpdater = require('../Subscription/FeaturesUpdater')
const SpellingHandler = require('../Spelling/SpellingHandler')
const { hasAdminAccess } = require('../Helpers/AdminAuthorizationHelper')
const InstitutionsFeatures = require('../Institutions/InstitutionsFeatures')
const ProjectAuditLogHandler = require('./ProjectAuditLogHandler')
const PublicAccessLevels = require('../Authorization/PublicAccessLevels')
const TagsHandler = require('../Tags/TagsHandler')
const TutorialHandler = require('../Tutorial/TutorialHandler')

/**
 * @typedef {import("./types").GetProjectsRequest} GetProjectsRequest
 * @typedef {import("./types").GetProjectsResponse} GetProjectsResponse
 * @typedef {import("./types").Project} Project
 */

const _ProjectController = {
  _isInPercentageRollout(rolloutName, objectId, percentage) {
    if (Settings.bypassPercentageRollouts === true) {
      return true
    }
    const data = `${rolloutName}:${objectId.toString()}`
    const md5hash = crypto.createHash('md5').update(data).digest('hex')
    const counter = parseInt(md5hash.slice(26, 32), 16)
    return counter % 100 < percentage
  },

  async updateProjectSettings(req, res) {
    const projectId = req.params.Project_id

    if (req.body.compiler != null) {
      await EditorController.promises.setCompiler(projectId, req.body.compiler)
    }

    if (req.body.imageName != null) {
      await EditorController.promises.setImageName(
        projectId,
        req.body.imageName
      )
    }

    if (req.body.name != null) {
      await EditorController.promises.renameProject(projectId, req.body.name)
    }

    if (req.body.spellCheckLanguage != null) {
      await EditorController.promises.setSpellCheckLanguage(
        projectId,
        req.body.spellCheckLanguage
      )
    }

    if (req.body.rootDocId != null) {
      await EditorController.promises.setRootDoc(projectId, req.body.rootDocId)
    }

    res.sendStatus(204)
  },

  async updateProjectAdminSettings(req, res) {
    const projectId = req.params.Project_id
    const user = SessionManager.getSessionUser(req.session)
    const publicAccessLevel = req.body.publicAccessLevel
    const publicAccessLevels = [
      PublicAccessLevels.READ_ONLY,
      PublicAccessLevels.READ_AND_WRITE,
      PublicAccessLevels.PRIVATE,
      PublicAccessLevels.TOKEN_BASED,
    ]

    if (
      req.body.publicAccessLevel != null &&
      publicAccessLevels.includes(publicAccessLevel)
    ) {
      await EditorController.promises.setPublicAccessLevel(
        projectId,
        req.body.publicAccessLevel
      )

      await ProjectAuditLogHandler.promises.addEntry(
        projectId,
        'toggle-access-level',
        user._id,
        req.ip,
        { publicAccessLevel: req.body.publicAccessLevel, status: 'OK' }
      )
      res.sendStatus(204)
    } else {
      res.sendStatus(500)
    }
  },

  async deleteProject(req, res) {
    const projectId = req.params.Project_id
    const user = SessionManager.getSessionUser(req.session)
    await ProjectDeleter.promises.deleteProject(projectId, {
      deleterUser: user,
      ipAddress: req.ip,
    })

    res.sendStatus(200)
  },

  async archiveProject(req, res) {
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    await ProjectDeleter.promises.archiveProject(projectId, userId)
    res.sendStatus(200)
  },

  async unarchiveProject(req, res) {
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    await ProjectDeleter.promises.unarchiveProject(projectId, userId)
    res.sendStatus(200)
  },

  async trashProject(req, res) {
    const projectId = req.params.project_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    await ProjectDeleter.promises.trashProject(projectId, userId)
    res.sendStatus(200)
  },

  async untrashProject(req, res) {
    const projectId = req.params.project_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    await ProjectDeleter.promises.untrashProject(projectId, userId)
    res.sendStatus(200)
  },

  async expireDeletedProjectsAfterDuration(_req, res) {
    await ProjectDeleter.promises.expireDeletedProjectsAfterDuration()
    res.sendStatus(200)
  },

  async expireDeletedProject(req, res) {
    const { projectId } = req.params
    await ProjectDeleter.promises.expireDeletedProject(projectId)
    res.sendStatus(200)
  },

  async restoreProject(req, res) {
    const projectId = req.params.Project_id
    await ProjectDeleter.promises.restoreProject(projectId)
    res.sendStatus(200)
  },

  async cloneProject(req, res, next) {
    res.setTimeout(5 * 60 * 1000) // allow extra time for the copy to complete
    metrics.inc('cloned-project')
    const projectId = req.params.Project_id
    const { projectName, tags } = req.body
    logger.debug({ projectId, projectName }, 'cloning project')
    if (!SessionManager.isUserLoggedIn(req.session)) {
      return res.json({ redir: '/register' })
    }
    const currentUser = SessionManager.getSessionUser(req.session)
    const { first_name: firstName, last_name: lastName, email } = currentUser
    try {
      const project = await ProjectDuplicator.promises.duplicate(
        currentUser,
        projectId,
        projectName,
        tags
      )
      res.json({
        name: project.name,
        lastUpdated: project.lastUpdated,
        project_id: project._id,
        owner_ref: project.owner_ref,
        owner: {
          first_name: firstName,
          last_name: lastName,
          email,
          _id: currentUser._id,
        },
      })
    } catch (err) {
      OError.tag(err, 'error cloning project', {
        projectId,
        userId: currentUser._id,
      })
      return next(err)
    }
  },

  async newProject(req, res) {
    const currentUser = SessionManager.getSessionUser(req.session)
    const {
      first_name: firstName,
      last_name: lastName,
      email,
      _id: userId,
    } = currentUser
    const projectName =
      req.body.projectName != null ? req.body.projectName.trim() : undefined
    const { template } = req.body

    const project = await (template === 'example'
      ? ProjectCreationHandler.promises.createExampleProject(
          userId,
          projectName
        )
      : ProjectCreationHandler.promises.createBasicProject(userId, projectName))

    res.json({
      project_id: project._id,
      owner_ref: project.owner_ref,
      owner: {
        first_name: firstName,
        last_name: lastName,
        email,
        _id: userId,
      },
    })
  },

  async renameProject(req, res) {
    const projectId = req.params.Project_id
    const newName = req.body.newProjectName
    await EditorController.promises.renameProject(projectId, newName)
    res.sendStatus(200)
  },

  async userProjectsJson(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    let projects = await ProjectGetter.promises.findAllUsersProjects(
      userId,
      'name lastUpdated publicAccesLevel archived trashed owner_ref'
    )

    // _buildProjectList already converts archived/trashed to booleans so isArchivedOrTrashed should not be used here
    projects = ProjectController._buildProjectList(projects, userId)
      .filter(p => !(p.archived || p.trashed))
      .map(p => ({ _id: p.id, name: p.name, accessLevel: p.accessLevel }))

    res.json({ projects })
  },

  async projectEntitiesJson(req, res) {
    const projectId = req.params.Project_id
    const project = await ProjectGetter.promises.getProject(projectId)

    const { docs, files } =
      ProjectEntityHandler.getAllEntitiesFromProject(project)
    const entities = docs
      .concat(files)
      // Sort by path ascending
      .sort((a, b) => (a.path > b.path ? 1 : a.path < b.path ? -1 : 0))
      .map(e => ({
        path: e.path,
        type: e.doc != null ? 'doc' : 'file',
      }))
    res.json({ project_id: projectId, entities })
  },

  async loadEditor(req, res, next) {
    const timer = new metrics.Timer('load-editor')
    if (!Settings.editorIsOpen) {
      return res.render('general/closed', { title: 'updating_site' })
    }

    let anonymous, userId, sessionUser
    if (SessionManager.isUserLoggedIn(req.session)) {
      sessionUser = SessionManager.getSessionUser(req.session)
      userId = SessionManager.getLoggedInUserId(req.session)
      anonymous = false
    } else {
      sessionUser = null
      anonymous = true
      userId = null
    }

    const projectId = req.params.Project_id

    // should not be used in place of split tests query param overrides (?my-split-test-name=my-variant)
    function shouldDisplayFeature(name, variantFlag) {
      if (req.query && req.query[name]) {
        return req.query[name] === 'true'
      } else {
        return variantFlag === true
      }
    }

    try {
      const splitTests = [
        !anonymous && 'bib-file-tpr-prompt',
        'compile-log-events',
        'null-test-share-modal',
        'paywall-cta',
        'pdf-caching-cached-url-lookup',
        'pdf-caching-mode',
        'pdf-caching-prefetch-large',
        'pdf-caching-prefetching',
        'pdf-controls',
        'pdfjs-40',
        'personal-access-token',
        'revert-file',
        'table-generator-promotion',
        'track-pdf-download',
        !anonymous && 'writefull-oauth-promotion',
        'ieee-stylesheet',
      ].filter(Boolean)

      const responses = await pProps(
        _.mapValues(
          {
            splitTestAssignments: async () => {
              const assignments = {}
              await Promise.all(
                splitTests.map(async splitTest => {
                  assignments[splitTest] =
                    await SplitTestHandler.promises.getAssignment(
                      req,
                      res,
                      splitTest
                    )
                })
              )
              return assignments
            },
            project: () =>
              ProjectGetter.promises.getProject(projectId, {
                name: 1,
                lastUpdated: 1,
                track_changes: 1,
                owner_ref: 1,
                brandVariationId: 1,
                overleaf: 1,
                tokens: 1,
              }),
            user: async () => {
              if (!userId) {
                SplitTestSessionHandler.promises
                  .sessionMaintenance(req, null)
                  .catch(err => {
                    logger.error(
                      { err },
                      'failed to update split test info in session'
                    )
                  })
                return defaultSettingsForAnonymousUser(userId)
              } else {
                User.updateOne(
                  { _id: new ObjectId(userId) },
                  { $set: { lastActive: new Date() } }
                )
                  .exec()
                  .catch(err => {
                    logger.error(
                      { err, userId },
                      'failed to update lastActive for user'
                    )
                  })

                const user = await User.findById(
                  userId,
                  'email first_name last_name referal_id signUpDate featureSwitches features featuresEpoch refProviders alphaProgram betaProgram isAdmin ace labsProgram completedTutorials writefull'
                ).exec()
                // Handle case of deleted user
                if (!user) {
                  UserController.logout(req, res, next)
                  return
                }

                logger.debug({ projectId, userId }, 'got user')
                SplitTestSessionHandler.promises
                  .sessionMaintenance(req, user)
                  .catch(err => {
                    logger.error(
                      { err },
                      'failed to update split test info in session'
                    )
                  })

                if (FeaturesUpdater.featuresEpochIsCurrent(user)) {
                  return user
                }

                return await ProjectController._refreshFeatures(req, user)
              }
            },
            userHasInstitutionLicence: async () => {
              if (!userId) {
                return false
              }
              try {
                return await InstitutionsFeatures.promises.hasLicence(userId)
              } catch {
                // Don't fail if we can't get affiliation licences
                return false
              }
            },
            learnedWords() {
              if (!userId) {
                return []
              }
              return SpellingHandler.promises.getUserDictionary(userId)
            },
            subscription() {
              if (!userId) {
                return
              }
              return SubscriptionLocator.promises.getUsersSubscription(userId)
            },
            userIsMemberOfGroupSubscription() {
              if (!sessionUser) {
                return false
              }
              return LimitationsManager.promises.userIsMemberOfGroupSubscription(
                sessionUser
              )
            },
            activate() {
              return InactiveProjectManager.promises.reactivateProjectIfRequired(
                projectId
              )
            },
            markAsOpened() {
              // don't need to wait for this to complete
              ProjectUpdateHandler.promises
                .markAsOpened(projectId)
                .catch(err => {
                  logger.error(
                    { err, projectId },
                    'failed to mark project as opened'
                  )
                })
            },
            isTokenMember() {
              if (!userId) {
                return
              }
              return CollaboratorsGetter.promises.userIsTokenMember(
                userId,
                projectId
              )
            },
            isInvitedMember() {
              return CollaboratorsGetter.promises.isUserInvitedMemberOfProject(
                userId,
                projectId
              )
            },
            flushToTpds: () => {
              return TpdsProjectFlusher.promises.flushProjectToTpdsIfNeeded(
                projectId
              )
            },
            projectTags() {
              if (!userId) {
                return []
              }
              return TagsHandler.promises.getTagsForProject(userId, projectId)
            },
          },
          promise => promise()
        )
      )

      const {
        project,
        user,
        userHasInstitutionLicence,
        learnedWords,
        subscription,
        userIsMemberOfGroupSubscription,
        isTokenMember,
        isInvitedMember,
        splitTestAssignments,
        projectTags,
      } = responses

      const brandVariation = project?.brandVariationId
        ? await BrandVariationsHandler.promises.getBrandVariationById(
            project.brandVariationId
          )
        : undefined

      const anonRequestToken = TokenAccessHandler.getRequestToken(
        req,
        projectId
      )
      const allowedImageNames = ProjectHelper.getAllowedImagesForUser(user)

      const privilegeLevel =
        await AuthorizationManager.promises.getPrivilegeLevelForProject(
          userId,
          projectId,
          anonRequestToken
        )

      let allowedFreeTrial = true

      if (privilegeLevel == null || privilegeLevel === PrivilegeLevels.NONE) {
        return res.sendStatus(401)
      }

      if (subscription != null) {
        allowedFreeTrial = false
      }

      let wsUrl = Settings.wsUrl
      let metricName = 'load-editor-ws'
      if (user.betaProgram && Settings.wsUrlBeta !== undefined) {
        wsUrl = Settings.wsUrlBeta
        metricName += '-beta'
      } else if (
        Settings.wsUrlV2 &&
        Settings.wsUrlV2Percentage > 0 &&
        (new ObjectId(projectId).getTimestamp() / 1000) % 100 <
          Settings.wsUrlV2Percentage
      ) {
        wsUrl = Settings.wsUrlV2
        metricName += '-v2'
      }
      if (req.query && req.query.ws === 'fallback') {
        // `?ws=fallback` will connect to the bare origin, and ignore
        //   the custom wsUrl. Hence it must load the client side
        //   javascript from there too.
        // Not resetting it here would possibly load a socket.io v2
        //  client and connect to a v0 endpoint.
        wsUrl = undefined
        metricName += '-fallback'
      }
      metrics.inc(metricName)

      if (userId) {
        AnalyticsManager.recordEventForUserInBackground(
          userId,
          'project-opened',
          {
            projectId: project._id,
          }
        )
      }

      const isAdminOrTemplateOwner =
        hasAdminAccess(user) || Settings.templates?.user_id === userId
      const showTemplatesServerPro =
        Features.hasFeature('templates-server-pro') && isAdminOrTemplateOwner

      const debugPdfDetach = shouldDisplayFeature('debug_pdf_detach')

      const detachRole = req.params.detachRole

      const showSymbolPalette =
        !Features.hasFeature('saas') ||
        (user.features && user.features.symbolPalette)

      // Persistent upgrade prompts
      // in header & in share project modal
      const showUpgradePrompt =
        Features.hasFeature('saas') &&
        userId &&
        !subscription &&
        !userIsMemberOfGroupSubscription &&
        !userHasInstitutionLicence

      const showPersonalAccessToken =
        userId &&
        (!Features.hasFeature('saas') ||
          req.query?.personal_access_token === 'true')

      const optionalPersonalAccessToken =
        userId &&
        !showPersonalAccessToken &&
        splitTestAssignments['personal-access-token'].variant === 'enabled' // `?personal-access-token=enabled`

      const template =
        detachRole === 'detached'
          ? 'project/ide-react-detached'
          : 'project/ide-react'

      res.render(template, {
        title: project.name,
        priority_title: true,
        bodyClasses: ['editor'],
        project_id: project._id,
        projectName: project.name,
        user: {
          id: userId,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          referal_id: user.referal_id,
          signUpDate: user.signUpDate,
          allowedFreeTrial,
          featureSwitches: user.featureSwitches,
          features: user.features,
          refProviders: _.mapValues(user.refProviders, Boolean),
          writefull: {
            enabled: Boolean(user.writefull?.enabled),
          },
          alphaProgram: user.alphaProgram,
          betaProgram: user.betaProgram,
          labsProgram: user.labsProgram,
          inactiveTutorials: TutorialHandler.getInactiveTutorials(user),
          isAdmin: hasAdminAccess(user),
        },
        userSettings: {
          mode: user.ace.mode,
          editorTheme: user.ace.theme,
          fontSize: user.ace.fontSize,
          autoComplete: user.ace.autoComplete,
          autoPairDelimiters: user.ace.autoPairDelimiters,
          pdfViewer: user.ace.pdfViewer,
          syntaxValidation: user.ace.syntaxValidation,
          fontFamily: user.ace.fontFamily || 'lucida',
          lineHeight: user.ace.lineHeight || 'normal',
          overallTheme: user.ace.overallTheme,
        },
        privilegeLevel,
        anonymous,
        isTokenMember,
        isRestrictedTokenMember: AuthorizationManager.isRestrictedUser(
          userId,
          privilegeLevel,
          isTokenMember,
          isInvitedMember
        ),
        languages: Settings.languages,
        learnedWords,
        editorThemes: THEME_LIST,
        legacyEditorThemes: LEGACY_THEME_LIST,
        maxDocLength: Settings.max_doc_length,
        brandVariation,
        allowedImageNames,
        gitBridgePublicBaseUrl: Settings.gitBridgePublicBaseUrl,
        gitBridgeEnabled: Features.hasFeature('git-bridge'),
        wsUrl,
        showSupport: Features.hasFeature('support'),
        showTemplatesServerPro,
        pdfjsVariant: splitTestAssignments['pdfjs-40'].variant,
        debugPdfDetach,
        showSymbolPalette,
        symbolPaletteAvailable: Features.hasFeature('symbol-palette'),
        detachRole,
        metadata: { viewport: false },
        showUpgradePrompt,
        fixedSizeDocument: true,
        useOpenTelemetry: Settings.useOpenTelemetryClient,
        showPersonalAccessToken,
        optionalPersonalAccessToken,
        hasTrackChangesFeature: Features.hasFeature('track-changes'),
        projectTags,
      })
      timer.done()
    } catch (err) {
      OError.tag(err, 'error getting details for project page')
      return next(err)
    }
  },

  async _refreshFeatures(req, user) {
    // If the feature refresh has failed in this session, don't retry
    // it - require the user to log in again.
    if (req.session.feature_refresh_failed) {
      metrics.inc('features-refresh', 1, {
        path: 'load-editor',
        status: 'skipped',
      })
      return user
    }
    // If the refresh takes too long then return the current
    // features. Note that the user.features property may still be
    // updated in the background after the promise is resolved.
    const abortController = new AbortController()
    const refreshTimeoutHandler = async () => {
      await setTimeout(5000, { signal: abortController.signal })
      req.session.feature_refresh_failed = {
        reason: 'timeout',
        at: new Date(),
      }
      metrics.inc('features-refresh', 1, {
        path: 'load-editor',
        status: 'timeout',
      })
      return user
    }

    // try to refresh user features now
    const timer = new metrics.Timer('features-refresh-on-load-editor')

    return Promise.race([
      refreshTimeoutHandler(),
      (async () => {
        try {
          user.features = await FeaturesUpdater.promises.refreshFeatures(
            user._id,
            'load-editor'
          )
          metrics.inc('features-refresh', 1, {
            path: 'load-editor',
            status: 'success',
          })
        } catch (err) {
          // keep a record to prevent unneceary retries and leave
          // the original features unmodified if the refresh failed
          req.session.feature_refresh_failed = {
            reason: 'error',
            at: new Date(),
          }
          metrics.inc('features-refresh', 1, {
            path: 'load-editor',
            status: 'error',
          })
        }
        abortController.abort()
        timer.done()
        return user
      })(),
    ])
  },

  _buildProjectList(allProjects, userId) {
    let project
    const { owned, readAndWrite, readOnly, tokenReadAndWrite, tokenReadOnly } =
      allProjects
    const projects = []
    for (project of owned) {
      projects.push(
        ProjectController._buildProjectViewModel(
          project,
          'owner',
          Sources.OWNER,
          userId
        )
      )
    }
    // Invite-access
    for (project of readAndWrite) {
      projects.push(
        ProjectController._buildProjectViewModel(
          project,
          'readWrite',
          Sources.INVITE,
          userId
        )
      )
    }
    for (project of readOnly) {
      projects.push(
        ProjectController._buildProjectViewModel(
          project,
          'readOnly',
          Sources.INVITE,
          userId
        )
      )
    }
    // Token-access
    //   Only add these projects if they're not already present, this gives us cascading access
    //   from 'owner' => 'token-read-only'
    for (project of tokenReadAndWrite) {
      if (
        projects.filter(p => p.id.toString() === project._id.toString())
          .length === 0
      ) {
        projects.push(
          ProjectController._buildProjectViewModel(
            project,
            'readAndWrite',
            Sources.TOKEN,
            userId
          )
        )
      }
    }
    for (project of tokenReadOnly) {
      if (
        projects.filter(p => p.id.toString() === project._id.toString())
          .length === 0
      ) {
        projects.push(
          ProjectController._buildProjectViewModel(
            project,
            'readOnly',
            Sources.TOKEN,
            userId
          )
        )
      }
    }

    return projects
  },

  _buildProjectViewModel(project, accessLevel, source, userId) {
    const archived = ProjectHelper.isArchived(project, userId)
    // If a project is simultaneously trashed and archived, we will consider it archived but not trashed.
    const trashed = ProjectHelper.isTrashed(project, userId) && !archived

    const model = {
      id: project._id,
      name: project.name,
      lastUpdated: project.lastUpdated,
      lastUpdatedBy: project.lastUpdatedBy,
      publicAccessLevel: project.publicAccesLevel,
      accessLevel,
      source,
      archived,
      trashed,
      owner_ref: project.owner_ref,
      isV1Project: false,
    }
    if (accessLevel === PrivilegeLevels.READ_ONLY && source === Sources.TOKEN) {
      model.owner_ref = null
      model.lastUpdatedBy = null
    }
    return model
  },

  _buildPortalTemplatesList(affiliations) {
    if (affiliations == null) {
      affiliations = []
    }
    const portalTemplates = []
    for (const aff of affiliations) {
      if (
        aff.portal &&
        aff.portal.slug &&
        aff.portal.templates_count &&
        aff.portal.templates_count > 0
      ) {
        const portalPath = aff.institution.isUniversity ? '/edu/' : '/org/'
        portalTemplates.push({
          name: aff.institution.name,
          url: Settings.siteUrl + portalPath + aff.portal.slug,
        })
      }
    }
    return portalTemplates
  },
}

const defaultSettingsForAnonymousUser = userId => ({
  id: userId,
  ace: {
    mode: 'none',
    theme: 'textmate',
    fontSize: '12',
    autoComplete: true,
    spellCheckLanguage: '',
    pdfViewer: '',
    syntaxValidation: true,
  },
  subscription: {
    freeTrial: {
      allowed: true,
    },
  },
  featureSwitches: {
    github: false,
  },
  alphaProgram: false,
  betaProgram: false,
  writefull: {
    enabled: false,
  },
})

const THEME_LIST = [
  'cobalt',
  'dracula',
  'eclipse',
  'monokai',
  'overleaf',
  'textmate',
]

const LEGACY_THEME_LIST = [
  'ambiance',
  'chaos',
  'chrome',
  'clouds',
  'clouds_midnight',
  'crimson_editor',
  'dawn',
  'dreamweaver',
  'github',
  'gob',
  'gruvbox',
  'idle_fingers',
  'iplastic',
  'katzenmilch',
  'kr_theme',
  'kuroir',
  'merbivore',
  'merbivore_soft',
  'mono_industrial',
  'nord_dark',
  'pastel_on_dark',
  'solarized_dark',
  'solarized_light',
  'sqlserver',
  'terminal',
  'tomorrow',
  'tomorrow_night',
  'tomorrow_night_blue',
  'tomorrow_night_bright',
  'tomorrow_night_eighties',
  'twilight',
  'vibrant_ink',
  'xcode',
]

const ProjectController = {
  archiveProject: expressify(_ProjectController.archiveProject),
  cloneProject: expressify(_ProjectController.cloneProject),
  deleteProject: expressify(_ProjectController.deleteProject),
  expireDeletedProject: expressify(_ProjectController.expireDeletedProject),
  expireDeletedProjectsAfterDuration: expressify(
    _ProjectController.expireDeletedProjectsAfterDuration
  ),
  loadEditor: expressify(_ProjectController.loadEditor),
  newProject: expressify(_ProjectController.newProject),
  projectEntitiesJson: expressify(_ProjectController.projectEntitiesJson),
  renameProject: expressify(_ProjectController.renameProject),
  restoreProject: expressify(_ProjectController.restoreProject),
  trashProject: expressify(_ProjectController.trashProject),
  unarchiveProject: expressify(_ProjectController.unarchiveProject),
  untrashProject: expressify(_ProjectController.untrashProject),
  updateProjectAdminSettings: expressify(
    _ProjectController.updateProjectAdminSettings
  ),
  updateProjectSettings: expressify(_ProjectController.updateProjectSettings),
  userProjectsJson: expressify(_ProjectController.userProjectsJson),

  _buildProjectList: _ProjectController._buildProjectList,
  _buildProjectViewModel: _ProjectController._buildProjectViewModel,
  _injectProjectUsers: _ProjectController._injectProjectUsers,
  _isInPercentageRollout: _ProjectController._isInPercentageRollout,
  _refreshFeatures: _ProjectController._refreshFeatures,
}

module.exports = ProjectController
