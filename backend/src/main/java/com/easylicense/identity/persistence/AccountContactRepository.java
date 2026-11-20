package com.easylicense.identity.persistence;

import com.easylicense.identity.domain.ContactType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface AccountContactRepository extends JpaRepository<AccountContactEntity, UUID> {

    Optional<AccountContactEntity> findByContactTypeAndNormalizedValue(
            ContactType contactType,
            String normalizedValue);

    boolean existsByContactTypeAndNormalizedValue(
            ContactType contactType,
            String normalizedValue);
}
