Feature: Income database
  As the income management application
  I want income records stored with the expected schema and constraints
  So that persisted financial data remains consistent

  Background:
    Given the income database is available

  Scenario: The income table has the migrated columns and indexes
    When I inspect the income database schema
    Then the income table has the required columns
    And the income table has the expected lookup indexes

  Scenario: An income record can be inserted, updated, and deleted
    When I insert a "consulting" income of 125050 cents in category "Freelance" received on "2026-05-01"
    Then the "consulting" income is persisted with its submitted values
    When I update the "consulting" income to 150025 cents and category "Business"
    Then the "consulting" income is persisted with the updated values
    When I delete the "consulting" income
    Then the "consulting" income no longer exists

  Scenario Outline: The database rejects a non-positive income amount
    When I attempt to insert a "<alias>" income of <amount> cents
    Then the database rejects the income because its amount must be positive
    And the "<alias>" income was not persisted

    Examples:
      | alias          | amount |
      | zero-amount    | 0      |
      | negative-amount | -1     |
