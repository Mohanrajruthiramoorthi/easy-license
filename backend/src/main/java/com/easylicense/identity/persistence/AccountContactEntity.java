package com.easylicense.identity.persistence;

import com.easylicense.identity.domain.ContactType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "identity_account_contact")
public class AccountContactEntity {

    @Id
    private UUID id;

    @Column(name = "account_id", nullable = false)
    private UUID accountId;

    @Enumerated(EnumType.STRING)
    @Column(name = "contact_type", nullable = false, length = 10)
    private ContactType contactType;

    @Column(name = "normalized_value", nullable = false, length = 254)
    private String normalizedValue;

    @Column(name = "verified_at")
    private Instant verifiedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected AccountContactEntity() {
    }

    public AccountContactEntity(
            UUID id,
            UUID accountId,
            ContactType contactType,
            String normalizedValue,
            Instant verifiedAt,
            Instant createdAt) {
        this.id = id;
        this.accountId = accountId;
        this.contactType = contactType;
        this.normalizedValue = normalizedValue;
        this.verifiedAt = verifiedAt;
        this.createdAt = createdAt;
    }

    public UUID getId() {
        return id;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public ContactType getContactType() {
        return contactType;
    }

    public String getNormalizedValue() {
        return normalizedValue;
    }

    public Instant getVerifiedAt() {
        return verifiedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public boolean isVerified() {
        return verifiedAt != null;
    }
}
