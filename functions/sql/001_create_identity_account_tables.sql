CREATE TABLE identity_account (
    id UUID PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    normalized_username VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_identity_account_username UNIQUE (normalized_username),
    CONSTRAINT ck_identity_account_status CHECK (
        status IN ('PENDING_VERIFICATION', 'ACTIVE', 'LOCKED', 'DISABLED')
    )
);

CREATE TABLE identity_account_contact (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL,
    contact_type VARCHAR(10) NOT NULL,
    normalized_value VARCHAR(254) NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_identity_contact_account
        FOREIGN KEY (account_id) REFERENCES identity_account (id),
    CONSTRAINT uq_identity_contact_value UNIQUE (contact_type, normalized_value),
    CONSTRAINT uq_identity_contact_account_type UNIQUE (account_id, contact_type),
    CONSTRAINT ck_identity_contact_type CHECK (contact_type IN ('EMAIL', 'MOBILE'))
);

CREATE INDEX ix_identity_contact_account_id
    ON identity_account_contact (account_id);
