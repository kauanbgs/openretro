import { Database, RefreshCw, ExternalLink } from "lucide-react";
export function CatalogConnection({
  error,
  onRetry,
}: {
  error?: string;
  onRetry: () => void;
}) {
  return (
    <div className="catalog-connection">
      <div className="large-icon">
        <Database size={30} />
      </div>
      <h2>Connect to IGDB</h2>
      <p>
        Browse real games, console libraries, cover art, and genres.
        <br />
        Your Twitch credentials stay in OpenRetro’s local backend.
      </p>
      {error && !error.includes("NOT_CONFIGURED") && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="connection-steps">
        <span>1</span>
        <div>
          <strong>Create a Twitch application</strong>
          <p>
            Enable two-factor authentication on Twitch, register an application,
            and choose the Confidential client type.
          </p>
          <a
            href="https://dev.twitch.tv/console/apps"
            target="_blank"
            rel="noreferrer"
          >
            Twitch developer console <ExternalLink size={13} />
          </a>
        </div>
        <span>2</span>
        <div>
          <strong>Add both credentials to .env.local</strong>
          <p>
            The file is in the OpenRetro project root and is excluded from Git.
          </p>
          <code>
            IGDB_CLIENT_ID=your_client_id
            <br />
            IGDB_CLIENT_SECRET=your_client_secret
          </code>
          <p>
            For an installed desktop build, use providers.env in the application
            data directory shown in Settings → Advanced.
          </p>
        </div>
        <span>3</span>
        <div>
          <strong>Check the connection</strong>
          <p>
            OpenRetro obtains and renews the access token automatically. No
            token needs to be pasted here.
          </p>
        </div>
      </div>
      <button className="button primary" onClick={onRetry}>
        <RefreshCw size={16} /> Check connection
      </button>
    </div>
  );
}
