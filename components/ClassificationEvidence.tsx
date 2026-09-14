import { classLabels, explanationSummary, type Factor } from '../lib/classification-evidence';
import styles from './ClassificationEvidence.module.css';

type Props = {
  classification: string;
  confidence: number;
  factors: Factor[];
  probabilities?: Record<string, number>;
  complete?: boolean;
  compact?: boolean;
};

export default function ClassificationEvidence({ classification, confidence, factors, probabilities, complete = false, compact = false }: Props) {
  const evidence = explanationSummary(classification, confidence, factors, probabilities, complete);
  const label = classLabels[classification] || classification;
  return <div className={`${styles.evidence} ${compact ? styles.compact : ''}`}>
    <p className={styles.opening}>{evidence.opening}</p>
    <section aria-label="Supporting evidence">
      <h5>Why {label} leads</h5>
      {evidence.supporting.length ? <>
        <p className={styles.note}>These inputs raise its model score:</p>
        <ul>{evidence.supporting.map(group => <li key={group.key}>{group.text}</li>)}</ul>
      </> : <p>{evidence.noSupport}</p>}
    </section>
    <section aria-label="Uncertainty">
      <h5>What creates uncertainty</h5>
      {evidence.opposing.length ? <>
        <p className={styles.note}>These inputs lower its model score:</p>
        <ul>{evidence.opposing.map(group => <li key={group.key}>{group.text}</li>)}</ul>
      </> : <p>{complete ? 'No inputs lower this class’s score in this explanation. That does not verify the predicted source.' : 'No opposing factors appear in this saved excerpt; other contributions may be missing.'}</p>}
    </section>
    <section aria-label="Closest alternative">
      <h5>Closest alternative</h5>
      <p>{evidence.alternative}</p>
    </section>
    <p className={styles.note}>{complete
      ? 'The ranking uses all inputs and each class’s baseline; these are the strongest grouped influences, not proof of the source.'
      : 'This saved result contains only an excerpt of the evidence. Load the full explanation to see the remaining influences.'}</p>
  </div>;
}
